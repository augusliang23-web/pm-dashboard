"""End-to-end SIMULATED recovery. Proves protocol behaviour against a model, not against Google Cloud."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

V3 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V3))
import recovery_sim as rs
from runner import ROLLBACK

SAVE, ATTN = 'savedashboardproject', 'setdashboardprojectattention'


def baseline_traffic(svc, rev):
    return [dict(type=rs.REVISION_TYPE, revision=rev, percent=100)]


class RecoveryTests(unittest.TestCase):
    def sim(self, **kw):
        s = rs.Sim(**kw); s.arm_and_request_rollback(); return s

    def assert_restored(self, s):
        for svc, rev in ((SAVE, rs.VERSIONS_BASELINE['save']), (ATTN, rs.VERSIONS_BASELINE['attention'])):
            svc_state = s.run.services[svc]
            self.assertEqual([{k: t[k] for k in ('type', 'revision', 'percent')} for t in svc_state['traffic']], baseline_traffic(svc, rev))
            self.assertEqual([{k: t[k] for k in ('type', 'revision', 'percent')} for t in svc_state['trafficStatuses']], baseline_traffic(svc, rev))

    # ---- happy path and what it must preserve ----
    def test_full_rollback_completes_only_after_the_authenticated_legacy_receipt(self):
        s = self.sim()
        self.assertFalse(s.drive(max_ticks=40))                         # everything restored, still waiting for the human receipt
        st = s.coord.state()
        self.assertNotEqual(st['mode'], 'ROLLED_BACK')
        self.assertEqual(st['completed'], ['rollback:' + x for x in ROLLBACK[:-1]])
        self.assert_restored(s)
        s.receipts.legacy = rs.legacy_receipt()
        self.assertTrue(s.drive())
        self.assertEqual(s.coord.state()['mode'], 'ROLLED_BACK')
        self.assertEqual(s.coord.state()['completed'], ['rollback:' + x for x in ROLLBACK])

    def test_rollback_changes_only_traffic_and_preserves_service_configuration(self):
        s = self.sim()
        before = {n: {k: v for k, v in deepcopy(s.run.services[n]).items() if k not in ('traffic', 'trafficStatuses', 'etag', 'reconciling')}
                  for n in (SAVE, ATTN)}
        iam = deepcopy(s.run.iam); revisions = deepcopy(s.run.revisions)
        s.receipts.legacy = rs.legacy_receipt(); self.assertTrue(s.drive())
        for n in (SAVE, ATTN):
            after = {k: v for k, v in s.run.services[n].items() if k not in ('traffic', 'trafficStatuses', 'etag', 'reconciling')}
            self.assertEqual(after, before[n])                          # ingress, invoker check, name, conditions
        self.assertEqual(s.run.iam, iam)                                # invocation policy untouched
        self.assertEqual(s.run.revisions, revisions)                    # candidate AND baseline revisions retained, none rebuilt
        self.assertEqual(sorted(s.run.applied), sorted([SAVE, ATTN]))   # exactly one effective mutation per service

    def test_no_request_outside_the_two_services_is_ever_made(self):
        s = self.sim(); s.receipts.legacy = rs.legacy_receipt(); s.drive()
        for method, path, query, body in s.run.calls:
            self.assertTrue(path.startswith(rs.BASE + 'services/%s' % SAVE) or path.startswith(rs.BASE + 'services/%s' % ATTN)
                            or path.startswith(rs.BASE + 'operations/'), path)
            self.assertIn(method, ('GET', 'PATCH'))

    # ---- duplicate / concurrent execution ----
    def test_duplicate_watchdog_with_same_owner_produces_one_mutation_per_service(self):
        s = self.sim(); other = s.make_coord('exec-A')
        for _ in range(40):
            s.run.advance(); s.tick(s.coord); s.tick(other)
        s.receipts.legacy = rs.legacy_receipt()
        for _ in range(20):
            s.run.advance(); s.tick(other); s.tick(s.coord)
        self.assertEqual(s.coord.state()['mode'], 'ROLLED_BACK')
        self.assertEqual(sorted(s.run.applied), sorted([SAVE, ATTN]))

    def test_second_claim_while_an_operation_is_in_flight_is_refused(self):
        s = self.sim(); c = s.coord
        s.tick(c); s.run.advance(); s.tick(c)                           # hosting, then reconcile
        s.tick(c)                                                       # restore_save submitted, operation recorded
        self.assertIsNotNone(c.state()['inflight'])
        for _ in range(3):
            self.assertEqual(s.make_coord('exec-A').claim_rollback('restore_attention', s.now)['reason'], 'RECONCILE_REQUIRED')
        self.assertEqual(len(s.run.applied), 1)

    def test_different_owner_cannot_drive_recovery(self):
        from cloud_bridge import Stale
        s = self.sim()
        with self.assertRaises(Stale):
            s.tick(s.make_coord('exec-B'))
        self.assertEqual(s.run.applied, [])

    # ---- interruption, lost responses, idempotency ----
    def test_restart_mid_rollback_resumes_without_repeating_effects(self):
        s = self.sim()
        for _ in range(7):
            s.run.advance(); s.tick()
        before = list(s.run.applied)
        fresh = s.make_coord('exec-A')                                  # process/VM died; new one resumes from the store
        s.receipts.legacy = rs.legacy_receipt()
        self.assertTrue(s.drive(fresh))
        self.assertEqual(sorted(s.run.applied), sorted([SAVE, ATTN]))
        self.assertTrue(set(before) <= set(s.run.applied))

    def test_lost_response_after_applied_mutation_is_reconciled_without_a_second_patch(self):
        s = self.sim(); s.run.lose_next_patch = True
        s.receipts.legacy = rs.legacy_receipt()
        self.assertTrue(s.drive())
        self.assertEqual(s.run.applied.count(SAVE), 1)
        self.assertIn('Unavailable', s.errors)
        self.assert_restored(s)

    def test_lost_request_with_unvalidated_etag_semantics_stays_fenced(self):
        s = self.sim(); s.run.drop_next_patch = True
        for _ in range(30):
            s.run.advance(); s.tick()
        st = s.coord.state()
        self.assertEqual(st['mode'], 'RECOVERY_HOLD')
        self.assertIsNotNone(st['inflight'])                            # unknown outcome => no blind retry, no second action
        self.assertEqual(s.run.applied, [])
        self.assertNotIn('rollback:restore_save', st['completed'])

    def test_lost_request_with_validated_etag_semantics_is_retried_exactly_once(self):
        s = self.sim(etag_semantics_validated=True); s.run.drop_next_patch = True
        s.receipts.legacy = rs.legacy_receipt()
        self.assertTrue(s.drive())
        self.assertEqual(s.run.applied.count(SAVE), 1)
        self.assert_restored(s)

    def test_provider_confirmed_operation_failure_frees_the_slot_for_a_retry(self):
        s = self.sim(); s.run.fail_ops = True
        for _ in range(8):
            s.run.advance(); s.tick()
        self.assertTrue(any(e['kind'] == 'PROVIDER_FAILED_CONFIRMED' for e in s.coord.state()['events']))
        s.run.fail_ops = False; s.receipts.legacy = rs.legacy_receipt()
        self.assertTrue(s.drive())
        self.assertGreaterEqual(s.run.applied.count(SAVE), 2)
        self.assert_restored(s)

    # ---- fail-closed behaviour ----
    def test_drift_holds_without_mutating_and_resumes_only_after_operator_clears_it(self):
        s = self.sim(); s.run.services[SAVE]['ingress'] = 'INGRESS_TRAFFIC_INTERNAL_ONLY'
        for _ in range(6):
            s.run.advance(); s.tick()
        st = s.coord.state()
        self.assertEqual((st['mode'], st['operator_hold'], st['incident'], st['inflight']), ('RECOVERY_HOLD', 'DRIFT', True, None))
        self.assertEqual(s.run.applied, [])
        n = len(s.run.calls); s.tick()
        self.assertEqual(len(s.run.calls), n)                           # held: no further provider traffic
        s.run.services[SAVE]['ingress'] = 'INGRESS_TRAFFIC_ALL'; s.coord.clear_hold(); s.receipts.legacy = rs.legacy_receipt()
        self.assertTrue(s.drive())

    def test_baseline_revision_drift_holds(self):
        s = self.sim(); s.run.revisions[(SAVE, rs.VERSIONS_BASELINE['save'])]['containers'][0]['image'] = 'x'
        for _ in range(6):
            s.run.advance(); s.tick()
        self.assertEqual(s.coord.state()['operator_hold'], 'DRIFT'); self.assertEqual(s.run.applied, [])

    def test_permission_denied_is_an_incident_not_progress(self):
        s = self.sim(); s.run.fail = 'deny'
        for _ in range(6):
            s.run.advance(); s.tick()
        st = s.coord.state()
        self.assertEqual((st['operator_hold'], st['incident']), ('PERMISSION_DENIED', True))
        self.assertEqual(s.run.applied, [])

    def test_transient_provider_outage_retries_without_holding(self):
        s = self.sim(); s.run.fail = 'network'
        for _ in range(4):
            s.run.advance(); s.tick()
        self.assertFalse(s.coord.state().get('operator_hold'))
        s.run.fail = None; s.receipts.legacy = rs.legacy_receipt()
        self.assertTrue(s.drive())

    def test_missing_or_invalid_legacy_receipt_never_completes_rollback(self):
        s = self.sim()
        for bad in (None, rs.legacy_receipt(attester='worker@example.invalid'),
                    rs.legacy_receipt(nonce='replay'), rs.legacy_receipt(versions=dict(rs.VERSIONS_CANDIDATE))):
            s.receipts.legacy = bad
            self.assertFalse(s.drive(max_ticks=25))
        self.assertNotEqual(s.coord.state()['mode'], 'ROLLED_BACK')

    def test_hard_deadline_overrun_is_an_incident_never_a_claimed_recovery(self):
        s = self.sim(); s.now = s.start + 3700
        s.tick(); s.coord.watch(s.start + 3601)
        self.assertTrue(s.coord.state()['incident'])
        self.assertFalse(s.coord.state()['accepted'])

    def test_recovery_proceeds_with_no_local_client_state(self):
        """Only the durable store and provider exist; every coordinator object is rebuilt each tick."""
        s = self.sim(); s.receipts.legacy = rs.legacy_receipt()
        for _ in range(60):
            s.run.advance()
            if s.tick(s.make_coord('exec-A')) == 'TERMINAL':
                break
        self.assertEqual(s.coord.state()['mode'], 'ROLLED_BACK')
        self.assert_restored(s)


if __name__ == '__main__':
    unittest.main()
