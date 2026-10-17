import copy
from pathlib import Path
import sys
import threading
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

class MemoryStore:
    def __init__(self):
        self.gen=0;self.value=None;self.lock=threading.Lock();self.fail=None
    def read(self):
        from cloud_bridge import Missing,Unavailable,Denied
        if self.fail=='network':raise Unavailable()
        if self.fail=='permission':raise Denied()
        if self.value is None:raise Missing()
        return self.gen,copy.deepcopy(self.value)
    def cas(self,generation,value):
        from cloud_bridge import Conflict,Unavailable,Denied
        with self.lock:
            if self.fail=='network':raise Unavailable()
            if self.fail=='permission':raise Denied()
            if generation!=self.gen:raise Conflict()
            self.gen+=1;self.value=copy.deepcopy(value);return self.gen

class TrustedReceipts:
    """Represents IAM-isolated reader; no worker write path in protocol."""
    def __init__(self):self.receipt=None;self.failure=None
    def read(self,release_id):
        from cloud_bridge import Denied
        if self.failure:raise Denied()
        return copy.deepcopy(self.receipt)

class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.store=MemoryStore();self.receipts=TrustedReceipts()
        self.outcome='UNKNOWN';self.infrastructure=True
    def coord(self,release='release-001',nonce='nonce-001'):
        from cloud_bridge import Coordinator
        return Coordinator(self.store,self.receipts,release,nonce,1000,
                           lambda action:self.outcome,lambda:self.infrastructure)
    def valid_receipt(self):
        from cloud_bridge import REQUIRED_CHECKS,SOURCE
        return dict(release_id='release-001',nonce='nonce-001',source=SOURCE,
                    started_at=1001,completed_at=1100,roles=['Admin','PM'],
                    checks={k:True for k in REQUIRED_CHECKS})
    def test_codex_quota_exit_needs_no_local_success_message(self):
        c=self.coord();c.arm()
        # No further runner/AI message is sent after startup.
        restarted=self.coord()
        self.assertEqual(restarted.watch(2800),'ROLLBACK_REQUESTED')
    def test_mac_shutdown_leaves_cloud_deadline_and_recovery_grant(self):
        local_client=self.coord();local_client.arm();del local_client
        remote=self.coord();remote.watch(2801)
        grant=remote.claim_rollback('restore_hosting',2802)
        self.assertTrue(grant['execute'])
        self.assertEqual(remote.state()['start'],1000)
    def test_missing_signal_or_hosting_success_does_not_disarm(self):
        c=self.coord();c.arm()
        self.assertEqual(c.watch(1100),'ACTIVE')
        self.assertEqual(c.watch(2800),'ROLLBACK_REQUESTED')
    def test_only_trusted_authenticated_receipt_plus_readback_can_disarm(self):
        c=self.coord();c.arm();self.receipts.receipt=self.valid_receipt()
        self.infrastructure=False
        self.assertNotEqual(c.watch(1101),'SUCCEEDED')
        self.infrastructure=True
        self.assertEqual(c.watch(1102),'SUCCEEDED')
    def test_deadline_cannot_be_reset_or_disarmed_with_late_proof(self):
        c=self.coord();c.arm();c.arm()
        self.assertEqual(c.state()['target'],2800)
        self.receipts.receipt=self.valid_receipt()
        self.assertEqual(c.watch(2801),'ROLLBACK_REQUESTED')
        self.assertFalse(c.state()['accepted'])
    def test_duplicate_rollback_trigger_grants_exactly_one_executor(self):
        c=self.coord();c.arm();c.watch(2801)
        other=self.coord();results=[]
        def claim(x):results.append(x.claim_rollback('restore_hosting',2802))
        a=threading.Thread(target=claim,args=(c,));b=threading.Thread(target=claim,args=(other,));a.start();b.start();a.join();b.join()
        self.assertEqual(sum(bool(x.get('execute'))for x in results),1)
    def test_interrupted_rollback_reconciles_completed_effect(self):
        c=self.coord();c.arm();c.watch(2801);g=c.claim_rollback('restore_hosting',2802)
        c.ack_operation(g['action_id'],'operations/001')
        self.outcome='DONE_VERIFIED'
        restart=self.coord();restart.reconcile()
        self.assertIsNone(restart.state()['inflight'])
        self.assertFalse(restart.claim_rollback('restore_hosting',2803)['execute'])
        self.assertTrue(restart.claim_rollback('restore_save',2803)['execute'])
    def test_network_failure_cannot_disarm_or_free_unknown_operation(self):
        from cloud_bridge import Unavailable
        c=self.coord();c.arm();c.watch(2801);c.claim_rollback('restore_hosting',2802)
        self.store.fail='network'
        with self.assertRaises(Unavailable):c.watch(2803)
        self.store.fail=None;c.reconcile()
        self.assertEqual(c.state()['mode'],'RECOVERY_HOLD')
        self.assertFalse(c.claim_rollback('restore_save',2804)['execute'])
    def test_permission_denied_is_not_missing_or_success(self):
        from cloud_bridge import Denied
        c=self.coord();c.arm();self.receipts.receipt=self.valid_receipt();self.receipts.failure=True
        with self.assertRaises(Denied):c.watch(1101)
        self.assertFalse(c.state()['accepted'])
    def test_stale_release_cannot_mutate_new_release(self):
        from cloud_bridge import Stale
        c=self.coord();c.arm();old=self.coord(release='old')
        gen=self.store.gen
        with self.assertRaises(Stale):old.watch(3000)
        self.assertEqual(self.store.gen,gen)
    def test_wrong_nonce_or_incomplete_authentication_is_rejected(self):
        c=self.coord();c.arm();r=self.valid_receipt();r['nonce']='replay';self.receipts.receipt=r
        self.assertEqual(c.watch(1101),'ACTIVE')
        r['nonce']='nonce-001';r['roles']=['Admin']
        self.assertEqual(c.watch(1102),'ACTIVE')
    def test_inflight_forward_operation_blocks_competing_rollback(self):
        c=self.coord();c.arm();g=c.claim_forward('close_legacy',1001);c.ack_operation(g['action_id'],'operations/forward')
        c.watch(2801)
        self.assertFalse(c.claim_rollback('restore_hosting',2802)['execute'])
        self.outcome='FAILED_CONFIRMED';c.reconcile()
        self.assertTrue(c.claim_rollback('restore_hosting',2803)['execute'])
    def test_remote_failure_record_is_release_bound_and_requests_rollback(self):
        from cloud_bridge import Stale
        c=self.coord();c.arm()
        with self.assertRaises(Stale):c.report_failure('old','nonce-001','SMOKE_FAILED')
        c.report_failure('release-001','nonce-001','SMOKE_FAILED')
        self.assertEqual(c.state()['mode'],'ROLLBACK_REQUESTED')
    def test_hard_ceiling_escalates_instead_of_claiming_recovery(self):
        c=self.coord();c.arm();c.watch(4601)
        self.assertTrue(c.state()['incident'])
        self.assertFalse(c.state()['accepted'])


    def test_missing_receipt_object_is_wait_not_permission_bypass(self):
        from cloud_bridge import Missing
        c=self.coord();c.arm()
        def missing(release):raise Missing()
        self.receipts.read=missing
        self.assertEqual(c.watch(1100),'ACTIVE')
        self.assertEqual(c.watch(2800),'ROLLBACK_REQUESTED')
    def test_full_recovery_requires_last_legacy_authenticated_check(self):
        from cloud_bridge import ROLLBACK
        c=self.coord();c.arm();c.watch(2801)
        self.outcome='DONE_VERIFIED'
        for step in ROLLBACK[:-1]:
            g=c.claim_rollback(step,2802);self.assertTrue(g['execute']);c.ack_operation(g['action_id'],'operations/'+step);c.reconcile()
        self.assertNotEqual(c.state()['mode'],'ROLLED_BACK')
        g=c.claim_rollback(ROLLBACK[-1],2803);c.ack_operation(g['action_id'],'operations/verify_auth');c.reconcile()
        self.assertEqual(c.state()['mode'],'ROLLED_BACK')
    def test_operation_receipt_cannot_contain_foreign_url_or_secret(self):
        c=self.coord();c.arm();c.watch(2801);g=c.claim_rollback('restore_hosting',2802)
        with self.assertRaises(ValueError):c.ack_operation(g['action_id'],'https://foreign.example/?token=secret')
        self.assertIsNone(c.state()['inflight']['operation'])

class GcsPreconditionTests(unittest.TestCase):
    def test_mutation_has_generation_precondition_and_403_is_not_absence(self):
        from cloud_bridge import GcsStore,Denied
        calls=[]
        def request(method,url,body=None):
            calls.append((method,url,body));return 200,{'generation':'8'}
        store=GcsStore('reviewed-bucket','coord/active.json',request)
        self.assertEqual(store.cas(7,{'release_id':'r'}),8)
        self.assertIn('ifGenerationMatch=7',calls[0][1])
        def denied(*args):return 403,{}
        with self.assertRaises(Denied):GcsStore('bucket','key',denied).read()

if __name__=='__main__':unittest.main()
