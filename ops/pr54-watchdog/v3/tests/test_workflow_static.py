"""Static review gates for the Workflows draft. These do NOT compile or run the workflow."""
import json
from pathlib import Path
import re
import sys
import unittest

V3 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V3))
import acceptance
import recovery_sim as rs
from runner import ROLLBACK, SOURCE, PROJECT

TEXT = (V3/'workflows'/'pr54-recovery-watchdog.yaml').read_text()
CODE = '\n'.join(l for l in TEXT.splitlines() if not l.lstrip().startswith('#'))
MANIFEST = json.loads((V3/'UAT_CLOUD_DRILL_AUTHORIZATION_MANIFEST_V3.json').read_text())
ALLOWED_HOSTS = {'storage.googleapis.com', 'run.googleapis.com', 'firebasehosting.googleapis.com', 'firebaserules.googleapis.com'}


def string_list(name):
    m = re.search(name + r': \[(.*?)\]', CODE)
    return re.findall(r'"([a-z_]+)"', m.group(1))


class WorkflowStaticTests(unittest.TestCase):
    def test_only_allowlisted_google_api_hosts(self):
        hosts = set(re.findall(r'https://([a-z0-9.-]+)/', CODE))
        self.assertEqual(hosts, ALLOWED_HOSTS)

    def test_forbidden_capabilities_are_absent(self):
        for needle in ('setIamPolicy', 'cloudfunctions.googleapis.com', 'cloudbuild.googleapis.com', 'iam.googleapis.com',
                       'firestore.googleapis.com', 'allUsers', 'allAuthenticatedUsers', 'serviceAccounts', 'secretmanager',
                       'generateAccessToken', 'signJwt', 'customToken', 'cookie', 'password', 'sourceCodeSet',
                       'buildConfig', 'DELETE', ':delete', 'workflows.googleapis.com'):
            self.assertNotIn(needle, CODE, needle)

    def test_invocation_setting_is_read_but_never_written(self):
        self.assertIsNone(re.search(r'^\s*invokerIamDisabled:', CODE, re.M))
        self.assertIsNone(re.search(r'^\s*ingress:', CODE, re.M))

    def test_every_cloud_run_mutation_is_a_traffic_only_mask(self):
        urls = re.findall(r'url: \$\{"https://run\.googleapis\.com/v2/"[^\n]*\}', CODE)
        patches = [u for u in urls if 'updateMask' in u]
        self.assertEqual(len(patches), 2)                                   # validateOnly + real
        for u in patches:
            self.assertIn('updateMask=traffic', u)
        self.assertEqual(len(re.findall(r'method: PATCH', CODE)), 3)        # 2 Cloud Run + 1 Rules
        run_blocks = re.findall(r'method: PATCH\n\s+url: \$\{"https://run\.googleapis\.com[^\n]*', CODE)
        self.assertTrue(all('updateMask=traffic' in b for b in run_blocks))

    def test_every_http_call_is_authenticated_and_bounded(self):
        calls = len(re.findall(r'call: http\.(?:get|post|request)', CODE))
        self.assertGreater(calls, 15)
        self.assertEqual(len(re.findall(r'type: OAuth2', CODE)), calls)
        self.assertEqual(len(re.findall(r'timeout: \d+', CODE)), calls)

    def test_coordinator_writes_are_generation_preconditioned(self):
        self.assertIn('ifGenerationMatch=', CODE)
        self.assertEqual(len(re.findall(r'uploadType=media', CODE)), 1)     # one write path only
        self.assertIn('generation: 0', CODE)                                # create-if-absent
        self.assertIn('alt=media&generation=', CODE)                        # reads pinned to metadata generation

    def test_server_origin_time_and_deadlines(self):
        self.assertIn('sys.now()', CODE)
        for expr in ('start + 1800', 'start + 2700', 'start + 3600'):
            self.assertIn(expr, CODE)
        self.assertNotIn('sys.sleep\n        args:\n          seconds: 0', CODE)

    def test_pinned_identity_matches_the_reviewed_runner(self):
        self.assertIn('"%s"' % PROJECT, CODE)
        self.assertIn('"%s"' % SOURCE, CODE)
        self.assertIn('"%s-pr54-recovery"' % PROJECT, CODE)
        self.assertEqual(MANIFEST['project']['id'], PROJECT)
        self.assertEqual(MANIFEST['source'], SOURCE)

    def test_rollback_order_and_acceptance_checks_match_the_python_reference(self):
        self.assertEqual(string_list('rollback_steps'), list(ROLLBACK))
        self.assertEqual(string_list('forward_checks'), list(acceptance.FORWARD_CHECKS))
        self.assertEqual(string_list('legacy_checks'), list(acceptance.LEGACY_CHECKS))

    def test_cloud_run_targets_come_from_the_approved_manifest_not_arguments(self):
        self.assertIn('manifest.baseline.services[step]', CODE)
        self.assertNotIn('args.revision', CODE)
        self.assertNotIn('args.service', CODE)
        self.assertEqual({v[0] for v in rs.SERVICES.values()}, set(MANIFEST['cloudRun']['allowlistedServices']))

    def test_stale_owner_is_fatal_but_other_errors_keep_supervising(self):
        self.assertIn('STALE_OWNER', CODE)
        self.assertRegex(CODE, r'condition: \$\{e == "STALE_OWNER"\}\n\s+raise: \$\{e\}')
        self.assertIn('next: loop', CODE)

    def test_logs_are_sanitized(self):
        for text in re.findall(r'text: (.*)', CODE):
            self.assertNotIn('body', text)
            self.assertNotIn('json.encode', text)


if __name__ == '__main__':
    unittest.main()
