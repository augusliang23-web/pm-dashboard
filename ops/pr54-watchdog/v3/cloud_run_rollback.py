"""Cloud Run traffic-rollback adapter (v3 design candidate).

Builds REST requests only. The caller injects an authorized transport
`request(method, url, body=None) -> (http_code, json_body)`; this module has no
default executor, no credential lookup and no shell/network access.

Rollback pins 100% of traffic on a pre-recorded baseline revision of one of two
allowlisted Cloud Run services that back the Functions v2 functions. It never
builds source, never touches IAM policy, never changes ingress/invoker/identity.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote, urlencode

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent/'imported'/'pr54-release-runner-20261016'))
sys.path.insert(0, str(HERE.parent/'imported'/'pr54-cloud-watchdog-20261016'))
from runner import PROJECT  # noqa: E402
from cloud_bridge import Missing, Conflict, Unavailable, Denied  # noqa: E402

REGION = 'us-central1'
HOST = 'https://run.googleapis.com/v2/'
REVISION_TYPE = 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION'
# rollback step -> (allowlisted Cloud Run service, pre-recorded baseline revision)
SERVICES = {
    'restore_save': ('savedashboardproject', 'savedashboardproject-00013-yow'),
    'restore_attention': ('setdashboardprojectattention', 'setdashboardprojectattention-00010-tix'),
}
_ID = re.compile(r'[a-z0-9][a-z0-9-]{0,62}')
_OP = re.compile(r'projects/' + re.escape(PROJECT) + '/locations/' + REGION + r'/operations/[A-Za-z0-9_-]{1,128}')


class Drift(Exception):
    """Live resource differs from the approved baseline. Never auto-repaired."""


class Preflight(Exception):
    """validateOnly or readiness evidence rejected the request."""


def _checked(result):
    code, body = result
    if code == 404: raise Missing()
    if code in (401, 403): raise Denied()
    if code in (409, 412): raise Conflict()
    if code == 429 or code >= 500: raise Unavailable()
    if code >= 400: raise Preflight('HTTP %d' % code)
    return body


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def revision_fingerprint(rev):
    """Immutable-template fields that define what rollback restores."""
    containers = [dict(image=c.get('image'), env=sorted(json.dumps(e, sort_keys=True) for e in c.get('env', [])),
                       args=c.get('args'), command=c.get('command'), resources=c.get('resources'))
                  for c in rev.get('containers', [])]
    return _digest(dict(serviceAccount=rev.get('serviceAccount'), containers=containers,
                        scaling=rev.get('scaling'), timeout=rev.get('timeout'),
                        executionEnvironment=rev.get('executionEnvironment'),
                        maxInstanceRequestConcurrency=rev.get('maxInstanceRequestConcurrency'),
                        vpcAccess=rev.get('vpcAccess')))


def service_static_fingerprint(svc, iam):
    """Service-level settings a traffic pin does NOT restore; any drift => HOLD."""
    bindings = sorted(json.dumps(b, sort_keys=True) for b in (iam or {}).get('bindings', []))
    return _digest(dict(ingress=svc.get('ingress'), invokerIamDisabled=bool(svc.get('invokerIamDisabled')),
                        defaultUriDisabled=bool(svc.get('defaultUriDisabled')), iam=bindings))


def _condition_ok(obj):
    return (obj.get('terminalCondition') or {}).get('state') == 'CONDITION_SUCCEEDED' or any(
        c.get('type') == 'Ready' and c.get('state') == 'CONDITION_SUCCEEDED' for c in obj.get('conditions', []))


class CloudRunRollback:
    def __init__(self, request, baselines, etag_semantics_validated=False):
        """baselines: {step: {'revision_fingerprint':..., 'service_fingerprint':...}} from the approved manifest."""
        self.request = request
        self.baselines = baselines
        self.etag_semantics_validated = etag_semantics_validated

    # ---- request construction (allowlisted; nothing else can be built) ----
    def _target(self, step):
        if step not in SERVICES:
            raise ValueError('Step is not a Cloud Run rollback step')
        service, revision = SERVICES[step]
        if not _ID.fullmatch(service) or not _ID.fullmatch(revision):
            raise ValueError('Invalid allowlist entry')
        return service, revision

    def _service_name(self, service):
        return 'projects/%s/locations/%s/services/%s' % (PROJECT, REGION, service)

    def _get(self, path):
        return _checked(self.request('GET', HOST + path))

    def patch_request(self, step, validate_only, etag=None):
        service, revision = self._target(step)
        name = self._service_name(service)
        query = {'updateMask': 'traffic'}
        if validate_only:
            query['validateOnly'] = 'true'
        body = {'name': name, 'traffic': [{'type': REVISION_TYPE, 'revision': revision, 'percent': 100}]}
        if etag:
            body['etag'] = etag
        return 'PATCH', HOST + quote(name, safe='/') + '?' + urlencode(query), body

    # ---- evidence ----
    def read_service(self, step):
        service, _ = self._target(step)
        name = self._service_name(service)
        svc = self._get(quote(name, safe='/'))
        iam = _checked(self.request('GET', HOST + quote(name, safe='/') + ':getIamPolicy'))
        return svc, iam

    def at_baseline(self, svc, step):
        _, revision = self._target(step)
        want = [{'type': REVISION_TYPE, 'revision': revision, 'percent': 100}]
        spec = [{k: t.get(k) for k in ('type', 'revision', 'percent')} for t in svc.get('traffic', [])]
        seen = [{k: t.get(k) for k in ('type', 'revision', 'percent')} for t in svc.get('trafficStatuses', [])]
        tagged = any(t.get('tag') for t in svc.get('traffic', []) + svc.get('trafficStatuses', []))
        return spec == want and seen == want and not tagged and not svc.get('reconciling') and _condition_ok(svc)

    def preflight(self, step):
        """Read-only. Raises Drift/Missing/Preflight; never mutates."""
        service, revision = self._target(step)
        base = self.baselines.get(step)
        if not base or not base.get('revision_fingerprint') or not base.get('service_fingerprint'):
            raise Drift('No approved baseline fingerprints for ' + step)
        rev = self._get(quote(self._service_name(service) + '/revisions/' + revision, safe='/'))
        if not _condition_ok(rev):
            raise Preflight('Baseline revision is not Ready')
        if revision_fingerprint(rev) != base['revision_fingerprint']:
            raise Drift('Baseline revision template differs from approved fingerprint')
        svc, iam = self.read_service(step)
        if service_static_fingerprint(svc, iam) != base['service_fingerprint']:
            raise Drift('Service ingress/invoker/IAM differs from approved baseline; traffic pin would not restore it')
        if any(t.get('tag') for t in svc.get('traffic', [])):
            raise Drift('Tagged traffic present')
        return dict(service=service, revision=revision, etag=svc.get('etag'), already_at_baseline=self.at_baseline(svc, step))

    # ---- mutation (only with a coordinator grant) ----
    def submit(self, step, grant, persist_precondition):
        """grant is the dict returned by Coordinator.claim_rollback. Returns the operation name or None.

        persist_precondition(etag) must durably record the pre-submission etag in the
        coordinator BEFORE the mutating call. If it raises, nothing is submitted.
        """
        if not grant or not grant.get('execute') or grant.get('direction') != 'rollback' or grant.get('step') != step:
            raise ValueError('No matching coordinator grant; refusing to submit')
        info = self.preflight(step)
        if not info['etag']:
            raise Preflight('Service etag unavailable; cannot establish a submission precondition')
        if info['already_at_baseline']:
            return None  # idempotent: nothing to do; verify() will confirm
        method, url, body = self.patch_request(step, True, info['etag'])
        evidence = _checked(self.request(method, url, body))  # validateOnly: necessary, never sufficient
        if not isinstance(evidence, dict):
            raise Preflight('validateOnly returned no evidence')
        # Everything above is provably not-submitted. Persist the precondition, then mutate.
        persist_precondition(info['etag'])
        method, url, body = self.patch_request(step, False, info['etag'])
        op = _checked(self.request(method, url, body))
        name = op.get('name') if isinstance(op, dict) else None
        if not isinstance(name, str) or not _OP.fullmatch(name):
            raise Preflight('Provider returned an unbound operation name')
        return name

    # ---- reconciliation (operation_verifier for the coordinator) ----
    def verify(self, action):
        step = action.get('step')
        if action.get('direction') != 'rollback' or step not in SERVICES:
            return 'UNKNOWN'
        try:
            svc, _ = self.read_service(step)
            op = action.get('operation')
            if op:
                if not _OP.fullmatch(op):
                    return 'UNKNOWN'
                state = self._get(quote(op, safe='/'))
                if not state.get('done'):
                    return 'UNKNOWN'
                if state.get('error'):
                    return 'FAILED_CONFIRMED'
                return 'DONE_VERIFIED' if self.at_baseline(svc, step) else 'UNKNOWN'
            if self.at_baseline(svc, step):
                return 'DONE_VERIFIED'
            if self.etag_semantics_validated and action.get('pre_etag') and svc.get('etag') == action['pre_etag']:
                return 'NOT_STARTED_CONFIRMED'
            return 'UNKNOWN'
        except Unavailable:
            return 'UNKNOWN'
