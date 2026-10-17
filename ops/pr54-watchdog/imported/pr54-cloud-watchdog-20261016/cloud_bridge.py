"""Generation-CAS protocol; explicit transport only. Does not execute cloud mutations by itself."""
from copy import deepcopy
import hashlib
import json
import re
from pathlib import Path
import sys
from urllib.parse import quote, urlencode

RUNNER = Path(__file__).resolve().parents[1]/'pr54-release-runner-20261016'
sys.path.insert(0,str(RUNNER))
from runner import SOURCE, PROJECT, FORWARD, ROLLBACK

REQUIRED_CHECKS=('firebase_auth','pm_ownership','save_draft','publish','overview_pdf',
                 'released_protection','archive_preservation','backend_operation')
class Missing(Exception):pass
class Conflict(Exception):pass
class Unavailable(Exception):pass
class Denied(Exception):pass
class Stale(Exception):pass

class GcsStore:
    """Caller injects authorized HTTP transport; no credential lookup or default executor.

    The active object is writable ONLY by Workflows. Workers use separate
    immutable message prefixes, not this coordinator store. JSON reads are
    pinned to metadata generation to prevent a torn metadata/body snapshot.
    """
    def __init__(self,bucket,key,request):
        self.bucket=bucket;self.key=key;self.request=request
    def _checked(self,result):
        code,body=result
        if code==404:raise Missing()
        if code in (401,403):raise Denied()
        if code in (409,412):raise Conflict()
        if code>=400:raise Unavailable()
        return body
    def read(self):
        base='https://storage.googleapis.com/storage/v1/b/'+quote(self.bucket,safe='')+'/o/'+quote(self.key,safe='')
        meta=self._checked(self.request('GET',base))
        generation=int(meta['generation'])
        body=self._checked(self.request('GET',base+'?'+urlencode({'alt':'media','generation':generation})))
        if not isinstance(body,dict):raise Unavailable('Invalid coordinator document')
        return generation,body
    def cas(self,generation,value):
        url='https://storage.googleapis.com/upload/storage/v1/b/'+quote(self.bucket,safe='')+'/o?'+urlencode({'uploadType':'media','name':self.key,'ifGenerationMatch':generation})
        result=self._checked(self.request('POST',url,deepcopy(value)))
        return int(result['generation'])

class Coordinator:
    """Workflows-side protocol. This object is not a worker authority.

    receipts.read is an IAM-isolated immutable smoke evidence reader;
    verifier is independent current cloud readback. No runner boolean,
    Hosting report, callback or uploaded token substitutes for either.
    """
    def __init__(self,store,receipts,release_id,nonce,start,operation_verifier,verifier):
        if not release_id or not nonce:raise ValueError('Missing release binding')
        self.store=store;self.receipts=receipts;self.release=release_id;self.nonce=nonce
        self.start=start;self.operation_verifier=operation_verifier;self.verifier=verifier
    def _validate(self,s):
        if (s.get('project')!=PROJECT or s.get('source')!=SOURCE or
            s.get('release_id')!=self.release or s.get('nonce')!=self.nonce or
            s.get('start')!=self.start or s.get('target')!=self.start+1800 or
            s.get('forward_stop')!=self.start+2700 or s.get('hard')!=self.start+3600):
            raise Stale('Release identity or immutable deadline mismatch')
    def arm(self):
        s=dict(project=PROJECT,source=SOURCE,release_id=self.release,nonce=self.nonce,
               start=self.start,target=self.start+1800,forward_stop=self.start+2700,hard=self.start+3600,
               mode='ACTIVE',accepted=False,incident=False,inflight=None,completed=[],events=[])
        try:self.store.cas(0,s)
        except Conflict:self.state()  # Exact resume only; never resets deadlines.
    def state(self):
        _,s=self.store.read();self._validate(s);return s
    def _change(self,fn):
        # CAS conflicts are retried after reloading identity/deadlines. Other
        # errors (including403) propagate; never interpreted as empty state.
        for _ in range(8):
            generation,s=self.store.read();self._validate(s);s=deepcopy(s)
            result=fn(s)
            try:self.store.cas(generation,s);return result
            except Conflict:continue
        raise Conflict('Concurrent coordination update; do not execute')
    def _event(self,s,kind):
        s['events'].append({'seq':len(s['events'])+1,'kind':kind})
    def report_failure(self,release_id,nonce,reason):
        if release_id!=self.release or nonce!=self.nonce:raise Stale()
        if reason not in ('SMOKE_FAILED','DEPLOY_FAILED','PERMISSION_DENIED','WORKER_FAILED'):
            raise ValueError('Use sanitized failure code, never raw errors/secrets')
        def change(s):
            if s['mode']!='SUCCEEDED':s['mode']='ROLLBACK_REQUESTED';self._event(s,reason)
        self._change(change)
    def _receipt_valid(self,r,now):
        return bool(isinstance(r,dict)and r.get('release_id')==self.release and r.get('nonce')==self.nonce
                    and r.get('source')==SOURCE and set(r.get('roles',[]))=={'Admin','PM'}
                    and isinstance(r.get('started_at'),(int,float))and isinstance(r.get('completed_at'),(int,float))
                    and self.start<=r['started_at']<=r['completed_at']<=now<self.start+1800
                    and all(r.get('checks',{}).get(k)is True for k in REQUIRED_CHECKS))
    def watch(self,now):
        current=self.state()
        if current['mode']=='SUCCEEDED':return 'SUCCEEDED' # Only this authority can write terminal success.
        # Missing receipt is a normal wait; denied receipt access is an error.
        # The receipt reader must enforce its isolated namespace IAM.
        try:
            r=self.receipts.read(self.release) if current['mode']=='ACTIVE'and now<current['target'] else None
        except Missing:
            r=None
        verified=self._receipt_valid(r,now) and self.verifier()
        def change(s):
            if now>=s['hard']:
                s['incident']=True;self._event(s,'RECOVERY_DEADLINE_EXCEEDED')
            if now<self.start:
                s['mode']='RECOVERY_HOLD';s['incident']=True;self._event(s,'CLOCK_OR_ANCHOR_INVALID')
            elif s['mode']=='ACTIVE':
                if now>=s['forward_stop'] or now>=s['target']:
                    s['mode']='ROLLBACK_REQUESTED';self._event(s,'MISSING_VERIFIED_SUCCESS_AT_DEADLINE')
                elif verified and s['inflight']is None:
                    s['mode']='SUCCEEDED';s['accepted']=True;s['disarmed_at']=now
                    self._event(s,'AUTHENTICATED_ACCEPTANCE_AND_CLOUD_READBACK_VERIFIED')
            return s['mode']
        return self._change(change)
    def _claim(self,direction,step,now):
        order=FORWARD if direction=='forward'else ROLLBACK
        if step not in order:raise ValueError('Step is not in existing runner allowlist')
        def change(s):
            key=direction+':'+step
            if key in s['completed']:return {'execute':False,'reason':'ALREADY_VERIFIED'}
            if s['inflight']is not None:return {'execute':False,'reason':'RECONCILE_REQUIRED'}
            if direction=='forward'and(s['mode']!='ACTIVE'or now>=s['target']or now>=s['forward_stop']):
                return {'execute':False,'reason':'FORWARD_FENCED'}
            if direction=='rollback'and s['mode']not in ('ROLLBACK_REQUESTED','ROLLING_BACK','RECOVERY_HOLD'):
                return {'execute':False,'reason':'ROLLBACK_NOT_REQUESTED'}
            expected=next((x for x in order if direction+':'+x not in s['completed']),None)
            if step!=expected:return {'execute':False,'reason':'OUT_OF_ORDER'}
            action_id=hashlib.sha256((self.release+':'+key).encode()).hexdigest()
            s['inflight']={'action_id':action_id,'direction':direction,'step':step,'operation':None,'intent_at':now}
            if direction=='rollback':s['mode']='ROLLING_BACK'
            self._event(s,'ACTION_GRANTED_'+key)
            return {'execute':True,**s['inflight']}
        return self._change(change)
    def claim_forward(self,step,now):return self._claim('forward',step,now)
    def claim_rollback(self,step,now):return self._claim('rollback',step,now)
    def ack_operation(self,action_id,operation):
        prefixes=('operations/','projects/'+PROJECT+'/locations/us-central1/operations/')
        if not isinstance(operation,str) or not operation.startswith(prefixes) or not re.fullmatch(r'[A-Za-z0-9_/-]{1,256}',operation):
            raise ValueError('Only bound operation resource names are permitted; never URLs or credentials')
        def change(s):
            a=s['inflight']
            if not a or a['action_id']!=action_id:raise Stale('Unknown action acknowledgment')
            if a['operation']and a['operation']!=operation:raise Stale('Conflicting operation receipt')
            a['operation']=operation;self._event(s,'OPERATION_RECEIPT_PERSISTED')
        self._change(change)
    def reconcile(self):
        before=self.state();a=before['inflight']
        if a is None:return 'NO_INFLIGHT'
        # This callback must inspect actual provider operation/result, not an
        # untrusted worker status string. UNKNOWN never frees an action slot.
        result=self.operation_verifier(deepcopy(a))
        def change(s):
            if s['inflight']!=a:raise Conflict('Action changed while verifying provider')
            if result in ('DONE_VERIFIED','FAILED_CONFIRMED','NOT_STARTED_CONFIRMED'):
                if result=='DONE_VERIFIED':s['completed'].append(a['direction']+':'+a['step'])
                s['inflight']=None;self._event(s,'PROVIDER_'+result)
                if a['direction']=='rollback'and all('rollback:'+x in s['completed']for x in ROLLBACK):
                    s['mode']='ROLLED_BACK';self._event(s,'RESTORATION_AND_LEGACY_AUTHENTICATED_SMOKE_VERIFIED')
            else:
                s['mode']='RECOVERY_HOLD';self._event(s,'PROVIDER_OUTCOME_UNKNOWN_OR_RUNNING')
            return s['mode']
        return self._change(change)
