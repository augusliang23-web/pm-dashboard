from pathlib import Path
import sys
import threading
import unittest

V3 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V3))
import recovery_sim as rs
from coordinator_v3 import CoordinatorV3, StepVerifiers
from cloud_bridge import Stale, Conflict, Unavailable
from runner import ROLLBACK


class OwnershipTests(unittest.TestCase):
    def setUp(self):
        self.sim = rs.Sim()

    def other_owner(self, owner='exec-B', **kw):
        s = self.sim
        return CoordinatorV3(s.store, s.receipts, kw.get('release', s.release), s.nonce, s.start, lambda a: 'UNKNOWN',
                             lambda: True, owner, kw.get('manifest', s.manifest_hash), kw.get('baseline', s.baseline_hash),
                             rs.VERSIONS_CANDIDATE, rs.VERSIONS_BASELINE)

    def test_same_owner_resume_never_resets_deadlines(self):
        self.sim.coord.arm()
        again = self.sim.make_coord('exec-A')
        again.arm()
        s = again.state()
        self.assertEqual((s['start'], s['target'], s['forward_stop'], s['hard']), (1000.0, 2800.0, 3700.0, 4600.0))
        self.assertEqual(self.sim.store.gen, 1)                 # no second write

    def test_duplicate_execution_with_a_different_owner_cannot_adopt_the_release(self):
        self.sim.coord.arm()
        intruder = self.other_owner()
        with self.assertRaises(Stale):
            intruder.arm()
        with self.assertRaises(Stale):
            intruder.watch(2900)
        with self.assertRaises(Stale):
            intruder.claim_rollback('restore_hosting', 2900)
        self.assertEqual(self.sim.store.gen, 1)

    def test_changed_manifest_or_baseline_binding_is_stale(self):
        self.sim.coord.arm()
        for kw in (dict(manifest='x' * 64), dict(baseline='y' * 64)):
            with self.assertRaises(Stale):
                self.other_owner('exec-A', **kw).state()

    def test_missing_bindings_refused_at_construction(self):
        s = self.sim
        for owner, mh, bh in (('', 'm', 'b'), ('o', '', 'b'), ('o', 'm', '')):
            with self.assertRaises(ValueError):
                CoordinatorV3(s.store, s.receipts, 'r', 'n', 1, None, None, owner, mh, bh, {}, {})

    def test_simultaneous_arm_has_a_single_winner(self):
        winners, losers = [], []
        def arm(owner):
            c = self.sim.make_coord(owner)
            try: c.arm(); winners.append(owner)
            except Stale: losers.append(owner)
        threads = [threading.Thread(target=arm, args=(o,)) for o in ('exec-A', 'exec-B')]
        [t.start() for t in threads]; [t.join() for t in threads]
        self.assertEqual((len(winners), len(losers)), (1, 1))
        self.assertEqual(self.sim.store.value['owner'], winners[0])


class SuccessGateTests(unittest.TestCase):
    def setUp(self):
        self.sim = rs.Sim()
        self.sim.coord.arm()

    def test_complete_receipt_plus_readback_succeeds_before_deadline(self):
        self.sim.receipts.forward = rs.forward_receipt()
        self.assertEqual(self.sim.coord.watch(1200), 'SUCCEEDED')
        self.assertTrue(self.sim.coord.state()['accepted'])

    def test_receipt_without_independent_readback_does_not_succeed(self):
        self.sim.receipts.forward = rs.forward_receipt(); self.sim.infra_ok = False
        self.assertEqual(self.sim.coord.watch(1200), 'ACTIVE')

    def test_each_missing_acceptance_item_keeps_the_release_active(self):
        for name in ('legacy_pm_save', 'attention', 'save_draft', 'save_publish', 'unauthorized_rejected',
                     'no_unexpected_mutation', 'versions_match'):
            with self.subTest(name):
                sim = rs.Sim(); sim.coord.arm()
                sim.receipts.forward = rs.forward_receipt()
                sim.receipts.forward['checks'][name] = False
                self.assertEqual(sim.coord.watch(1200), 'ACTIVE')

    def test_hosting_only_evidence_never_succeeds(self):
        r = rs.forward_receipt(); r['versions'] = dict(rs.VERSIONS_BASELINE, hosting=rs.VERSIONS_CANDIDATE['hosting'])
        self.sim.receipts.forward = r
        self.assertEqual(self.sim.coord.watch(1200), 'ACTIVE')

    def test_worker_cannot_attest_itself(self):
        self.sim.receipts.forward = rs.forward_receipt(attester='worker@example.invalid')
        self.assertEqual(self.sim.coord.watch(1200), 'ACTIVE')

    def test_late_receipt_cannot_disarm(self):
        self.sim.receipts.forward = rs.forward_receipt()
        self.assertEqual(self.sim.coord.watch(2801), 'ROLLBACK_REQUESTED')
        self.assertFalse(self.sim.coord.state()['accepted'])


class RolloverTests(unittest.TestCase):
    def finish(self, sim):
        sim.arm_and_request_rollback()
        sim.receipts.legacy = rs.legacy_receipt()
        self.assertTrue(sim.drive())

    def test_rollover_after_verified_terminal_state_records_previous_generation(self):
        a = rs.Sim(release='rel-1'); self.finish(a)
        gen = a.store.gen
        nxt = CoordinatorV3(a.store, a.receipts, 'rel-2', 'nonce-2', 9000.0, lambda x: 'UNKNOWN', lambda: True,
                            'exec-B', 'n' * 64, 'b' * 64, rs.VERSIONS_CANDIDATE, rs.VERSIONS_BASELINE)
        nxt.rollover()
        s = nxt.state()
        self.assertEqual((s['release_id'], s['owner'], s['mode']), ('rel-2', 'exec-B', 'ACTIVE'))
        self.assertEqual(s['previous'], dict(release_id='rel-1', owner='exec-A', generation=gen, final_mode='ROLLED_BACK', manifest_hash='m' * 64))
        with self.assertRaises(Stale):                       # the old execution cannot touch the new release
            a.coord.watch(9100)
        with self.assertRaises(Stale):
            a.coord.claim_rollback('restore_hosting', 9100)

    def test_rollover_refused_while_active_or_with_an_unreconciled_action(self):
        a = rs.Sim(); a.coord.arm()
        nxt = CoordinatorV3(a.store, a.receipts, 'rel-2', 'n2', 9000.0, None, None, 'exec-B', 'n' * 64, 'b' * 64, {}, {})
        with self.assertRaises(Stale):
            nxt.rollover()
        a.arm_and_request_rollback(); a.coord.claim_rollback('restore_hosting', a.now)
        with self.assertRaises(Stale):
            nxt.rollover()

    def test_two_concurrent_rollovers_have_one_winner(self):
        a = rs.Sim(); self.finish(a)
        outcomes = []
        def go(owner, rel):
            c = CoordinatorV3(a.store, a.receipts, rel, 'n-' + rel, 9000.0, None, None, owner, 'n' * 64, 'b' * 64, {}, {})
            try: c.rollover(); outcomes.append('won')
            except (Stale, Conflict): outcomes.append('lost')
        ts = [threading.Thread(target=go, args=('exec-B', 'rel-2')), threading.Thread(target=go, args=('exec-C', 'rel-3'))]
        [t.start() for t in ts]; [t.join() for t in ts]
        self.assertEqual(sorted(outcomes), ['lost', 'won'])

    def test_same_release_cannot_roll_over_onto_itself(self):
        a = rs.Sim(); self.finish(a)
        with self.assertRaises(Stale):
            a.make_coord('exec-A').rollover()


class SafetyPrimitiveTests(unittest.TestCase):
    def test_step_verifiers_fail_closed(self):
        v = StepVerifiers({'restore_save': lambda a: 'DONE_VERIFIED', 'bad': lambda a: 'yes'})
        self.assertEqual(v(dict(direction='rollback', step='restore_save')), 'DONE_VERIFIED')
        for action in (dict(direction='rollback', step='restore_hosting'), dict(direction='forward', step='restore_save'),
                       dict(direction='rollback', step='bad'), {}):
            self.assertEqual(v(action), 'UNKNOWN')

    def test_operator_hold_fences_claims_until_cleared(self):
        sim = rs.Sim(); sim.arm_and_request_rollback(); c = sim.coord
        c.hold('DRIFT')
        self.assertEqual(c.claim_rollback('restore_hosting', sim.now), {'execute': False, 'reason': 'OPERATOR_HOLD'})
        self.assertTrue(c.state()['incident'])
        c.clear_hold()
        self.assertTrue(c.claim_rollback('restore_hosting', sim.now)['execute'])
        with self.assertRaises(ValueError):
            c.hold('anything with a raw error: secret')

    def test_release_unsubmitted_only_when_nothing_was_persisted(self):
        sim = rs.Sim(); sim.arm_and_request_rollback(); c = sim.coord
        g = c.claim_rollback('restore_hosting', sim.now)
        c.ack_submission(g['action_id'], 'etag-1')
        with self.assertRaises(Stale):
            c.release_unsubmitted(g['action_id'], 'X')
        sim2 = rs.Sim(); sim2.arm_and_request_rollback()
        g2 = sim2.coord.claim_rollback('restore_hosting', sim2.now)
        sim2.coord.release_unsubmitted(g2['action_id'], 'DRIFT')
        self.assertIsNone(sim2.coord.state()['inflight'])

    def test_ack_submission_input_is_bounded_and_bound_to_the_action(self):
        sim = rs.Sim(); sim.arm_and_request_rollback(); c = sim.coord
        g = c.claim_rollback('restore_hosting', sim.now)
        for bad in ('', None, 5, 'x' * 300):
            with self.assertRaises(ValueError):
                c.ack_submission(g['action_id'], bad)
        with self.assertRaises(Stale):
            c.ack_submission('other-action', 'etag')

    def test_store_outage_and_denial_are_errors_not_state(self):
        sim = rs.Sim(); sim.coord.arm(); sim.store.fail = 'network'
        with self.assertRaises(Unavailable):
            sim.coord.watch(2900)
        sim.store.fail = None
        self.assertEqual(sim.coord.state()['mode'], 'ACTIVE')


if __name__ == '__main__':
    unittest.main()
