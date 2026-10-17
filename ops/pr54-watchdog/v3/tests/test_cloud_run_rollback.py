from copy import deepcopy
from pathlib import Path
import sys
import unittest

V3 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V3))
import recovery_sim as rs
from cloud_run_rollback import CloudRunRollback, Drift, Preflight, Missing, Conflict, Denied, Unavailable, SERVICES

STEP = 'restore_save'
SVC, BASE_REV = SERVICES[STEP]
GRANT = dict(execute=True, direction='rollback', step=STEP, action_id='a1')


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.run = rs.FakeCloudRun()
        self.adapter = CloudRunRollback(self.run.request, self.run.baselines())
        self.persisted = []

    def persist(self, etag):
        # record how many mutating calls had been made when the precondition was persisted
        self.persisted.append((etag, len(self.run.patches())))

    # ---------- request construction ----------
    def test_only_a_traffic_mask_pinning_the_baseline_revision_can_be_built(self):
        for validate in (True, False):
            method, url, body = self.adapter.patch_request(STEP, validate, 'e')
            self.assertEqual(method, 'PATCH')
            self.assertIn('updateMask=traffic', url)
            self.assertEqual(('validateOnly=true' in url), validate)
            self.assertEqual(set(body), {'name', 'traffic', 'etag'})
            self.assertEqual(body['traffic'], [dict(type=rs.REVISION_TYPE, revision=BASE_REV, percent=100)])
            self.assertTrue(url.startswith('https://run.googleapis.com/v2/projects/%s/locations/us-central1/services/%s?' % (rs.PROJECT, SVC)))

    def test_unlisted_steps_and_services_cannot_be_targeted(self):
        for step in ('restore_hosting', 'restore_rules', 'close_legacy', '../x', ''):
            with self.assertRaises(ValueError):
                self.adapter.patch_request(step, False)

    # ---------- preflight / drift ----------
    def test_preflight_passes_on_approved_baseline(self):
        info = self.adapter.preflight(STEP)
        self.assertEqual((info['service'], info['revision'], info['already_at_baseline']), (SVC, BASE_REV, False))

    def test_missing_baseline_fingerprint_refuses(self):
        a = CloudRunRollback(self.run.request, {})
        with self.assertRaises(Drift):
            a.preflight(STEP)

    def test_baseline_revision_template_drift_is_rejected(self):
        self.run.revisions[(SVC, BASE_REV)]['containers'][0]['image'] = 'tampered'
        with self.assertRaises(Drift):
            self.adapter.preflight(STEP)

    def test_baseline_revision_env_scaling_and_identity_drift_are_rejected(self):
        for mutate in (lambda r: r['containers'][0]['env'].append(dict(name='X', value='1')),
                       lambda r: r.update(scaling=dict(maxInstanceCount=21)),
                       lambda r: r.update(serviceAccount='other@x.iam.gserviceaccount.com')):
            with self.subTest():
                run = rs.FakeCloudRun(); a = CloudRunRollback(run.request, run.baselines())
                mutate(run.revisions[(SVC, BASE_REV)])
                with self.assertRaises(Drift):
                    a.preflight(STEP)

    def test_service_level_settings_that_a_traffic_pin_cannot_restore_are_drift(self):
        for mutate in (lambda s, i: s.update(invokerIamDisabled=False),
                       lambda s, i: s.update(ingress='INGRESS_TRAFFIC_INTERNAL_ONLY'),
                       lambda s, i: i['bindings'].append(dict(role='roles/run.invoker', members=['allUsers']))):
            with self.subTest():
                run = rs.FakeCloudRun(); a = CloudRunRollback(run.request, run.baselines())
                mutate(run.services[SVC], run.iam[SVC])
                with self.assertRaises(Drift):
                    a.preflight(STEP)

    def test_tagged_traffic_is_drift(self):
        self.run.services[SVC]['traffic'][0]['tag'] = 'canary'
        with self.assertRaises(Drift):
            self.adapter.preflight(STEP)

    def test_baseline_revision_not_ready_or_missing(self):
        self.run.revisions[(SVC, BASE_REV)]['conditions'] = [dict(type='Ready', state='CONDITION_FAILED')]
        with self.assertRaises(Preflight):
            self.adapter.preflight(STEP)
        del self.run.revisions[(SVC, BASE_REV)]
        with self.assertRaises(Missing):
            self.adapter.preflight(STEP)

    def test_http_errors_map_to_fail_closed_exceptions(self):
        self.run.fail = 'deny'
        with self.assertRaises(Denied):
            self.adapter.preflight(STEP)
        self.run.fail = 'network'
        with self.assertRaises(Unavailable):
            self.adapter.preflight(STEP)

    # ---------- submission ----------
    def test_submit_requires_a_matching_coordinator_grant(self):
        for grant in (None, {}, dict(GRANT, execute=False), dict(GRANT, direction='forward'), dict(GRANT, step='restore_attention')):
            with self.assertRaises(ValueError):
                self.adapter.submit(STEP, grant, self.persist)
        self.assertEqual(self.run.calls, [])

    def test_validate_only_precedes_precondition_which_precedes_the_mutation(self):
        op = self.adapter.submit(STEP, GRANT, self.persist)
        self.assertRegex(op, r'operations/op1$')
        patches = [c for c in self.run.calls if c[0] == 'PATCH']
        self.assertEqual(['validateOnly=true' in c[2] for c in patches], [True, False])
        self.assertEqual(self.persisted, [('etag-1', 0)])        # persisted before any real mutation
        self.assertEqual(len(self.run.patches()), 1)

    def test_validate_only_does_not_mutate(self):
        method, url, body = self.adapter.patch_request(STEP, True, 'etag-1')
        before = deepcopy(self.run.services[SVC])
        self.assertEqual(self.run.request(method, url, body)[0], 200)
        self.assertEqual(self.run.services[SVC], before)

    def test_persist_failure_blocks_the_mutation(self):
        def boom(etag): raise Conflict()
        with self.assertRaises(Conflict):
            self.adapter.submit(STEP, GRANT, boom)
        self.assertEqual(self.run.patches(), [])

    def test_already_at_baseline_is_a_noop(self):
        self.adapter.submit(STEP, GRANT, self.persist); self.run.advance()
        before = len(self.run.patches())
        self.assertIsNone(self.adapter.submit(STEP, GRANT, self.persist))
        self.assertEqual(len(self.run.patches()), before)

    def test_etag_race_between_preflight_and_mutation_is_rejected(self):
        original = self.run.request
        def racing(method, url, body=None):
            if method == 'PATCH' and 'validateOnly' not in url:
                self.run.services[SVC]['etag'] = 'etag-other-writer'
            return original(method, url, body)
        a = CloudRunRollback(racing, self.run.baselines())
        with self.assertRaises(Conflict):
            a.submit(STEP, GRANT, self.persist)
        self.assertEqual(self.run.applied, [])                       # provider rejected it; nothing changed
        self.assertEqual(self.run.services[SVC]['traffic'][0]['revision'], rs.VERSIONS_CANDIDATE['save'])

    def test_unbound_operation_name_is_refused(self):
        original = self.run.request
        def bad(method, url, body=None):
            code, out = original(method, url, body)
            if method == 'PATCH' and 'validateOnly' not in url:
                return 200, dict(name='https://evil.example/?token=x')
            return code, out
        with self.assertRaises(Preflight):
            CloudRunRollback(bad, self.run.baselines()).submit(STEP, GRANT, self.persist)

    # ---------- reconciliation ----------
    def action(self, operation=None, **kw):
        return dict(direction='rollback', step=STEP, action_id='a1', operation=operation, **kw)

    def test_verify_outcomes(self):
        pre = self.run.services[SVC]['etag']
        op = self.adapter.submit(STEP, GRANT, self.persist)
        self.assertEqual(self.adapter.verify(self.action(operation=op)), 'UNKNOWN')          # still running
        self.run.advance()
        self.assertEqual(self.adapter.verify(self.action(operation=op)), 'DONE_VERIFIED')
        self.assertEqual(self.adapter.verify(self.action()), 'DONE_VERIFIED')                # idempotent: state is desired state
        run = rs.FakeCloudRun(); a = CloudRunRollback(run.request, run.baselines())
        op = a.submit(STEP, GRANT, lambda e: None); run.fail_ops = True; run.advance()
        self.assertEqual(a.verify(self.action(operation=op)), 'FAILED_CONFIRMED')
        self.assertEqual(pre, 'etag-1')

    def test_unrecorded_submission_is_unknown_unless_etag_semantics_were_validated(self):
        act = self.action(pre_etag='etag-1')
        self.assertEqual(self.adapter.verify(act), 'UNKNOWN')
        validated = CloudRunRollback(self.run.request, self.run.baselines(), etag_semantics_validated=True)
        self.assertEqual(validated.verify(act), 'NOT_STARTED_CONFIRMED')
        self.run.services[SVC]['etag'] = 'etag-9'                                           # someone changed it
        self.assertEqual(validated.verify(act), 'UNKNOWN')
        self.assertEqual(validated.verify(self.action()), 'UNKNOWN')                         # no precondition recorded

    def test_verify_never_confirms_when_provider_unreachable_or_wrong_step(self):
        self.run.fail = 'network'
        self.assertEqual(self.adapter.verify(self.action(pre_etag='etag-1')), 'UNKNOWN')
        self.run.fail = None
        self.assertEqual(self.adapter.verify(dict(direction='forward', step=STEP)), 'UNKNOWN')
        self.assertEqual(self.adapter.verify(dict(direction='rollback', step='restore_rules')), 'UNKNOWN')
        self.assertEqual(self.adapter.verify(self.action(operation='https://evil.example/x')), 'UNKNOWN')

    def test_traffic_not_fully_observed_is_not_baseline(self):
        self.adapter.submit(STEP, GRANT, self.persist)       # spec updated, statuses/reconciling not yet
        self.assertEqual(self.adapter.verify(self.action()), 'UNKNOWN')

    # ---------- least privilege of the request surface ----------
    def test_adapter_never_emits_iam_functions_or_deploy_calls(self):
        self.adapter.submit(STEP, GRANT, self.persist); self.run.advance()
        self.adapter.verify(self.action(operation='projects/%s/locations/us-central1/operations/op1' % rs.PROJECT))
        for method, path, query, body in self.run.calls:
            self.assertIn(method, ('GET', 'PATCH'))
            self.assertNotIn(':setIamPolicy', path)
            self.assertNotIn('cloudfunctions', path)
            if method == 'PATCH':
                self.assertEqual(path, rs.BASE + 'services/' + SVC)
                self.assertIn('updateMask=traffic', query)
                self.assertEqual(set(body), {'name', 'traffic', 'etag'})


if __name__ == '__main__':
    unittest.main()
