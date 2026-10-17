import copy
from pathlib import Path
import sys
import unittest

V3 = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(V3))
import acceptance
import recovery_sim as rs

ARGS = dict(release_id='rel-1', nonce='nonce-1', manifest_hash='m' * 64, source=rs.SOURCE, start=1000,
            attesters={'attester@example.invalid'}, worker_principals=('worker@example.invalid',))


def check(receipt, kind='forward', now=1200, deadline=2800, versions=None):
    return acceptance.validate_receipt(receipt, kind=kind, deadline=deadline, now=now,
                                       expected_versions=versions or rs.VERSIONS_CANDIDATE, **ARGS)


class AcceptanceTests(unittest.TestCase):
    def test_complete_forward_receipt_passes(self):
        self.assertEqual(check(rs.forward_receipt()), (True, []))

    def test_complete_legacy_receipt_passes_without_pr54_only_endpoints(self):
        self.assertNotIn('save_draft', acceptance.LEGACY_CHECKS)
        self.assertNotIn('save_publish', acceptance.LEGACY_CHECKS)
        self.assertEqual(check(rs.legacy_receipt(), 'legacy', 2000, 4600, rs.VERSIONS_BASELINE), (True, []))

    def test_every_required_check_is_individually_necessary(self):
        for kind, names, make, versions in (('forward', acceptance.FORWARD_CHECKS, rs.forward_receipt, rs.VERSIONS_CANDIDATE),
                                            ('legacy', acceptance.LEGACY_CHECKS, rs.legacy_receipt, rs.VERSIONS_BASELINE)):
            for name in names:
                with self.subTest(kind=kind, check=name):
                    r = make()
                    r['checks'][name] = False
                    self.assertFalse(check(r, kind, 1500, 4600, versions)[0])
                    r['checks'].pop(name)
                    self.assertFalse(check(r, kind, 1500, 4600, versions)[0])

    def test_required_user_visible_checks_are_present(self):
        for name in ('legacy_pm_save', 'attention', 'save_draft', 'save_publish', 'unauthorized_rejected',
                     'no_unexpected_mutation', 'versions_match'):
            self.assertIn(name, acceptance.FORWARD_CHECKS)

    def test_truthy_non_boolean_does_not_count(self):
        r = rs.forward_receipt()
        r['checks']['save_publish'] = 'true'
        self.assertFalse(check(r)[0])

    def test_hosting_only_or_wrong_versions_rejected(self):
        for key in acceptance.VERSION_KEYS:
            with self.subTest(key=key):
                r = rs.forward_receipt()
                r['versions'][key] = 'something-else'
                self.assertFalse(check(r)[0])
        r = rs.forward_receipt()
        del r['versions']['save']
        self.assertFalse(check(r)[0])

    def test_dirty_or_missing_mutation_ledger_rejected(self):
        for mutate in (lambda l: l.update(unexpected_writes=1), lambda l: l.update(synthetic_ids_only=False),
                       lambda l: l.update(historical_or_archive_writes=2), lambda l: l.clear()):
            r = rs.forward_receipt()
            mutate(r['mutation_ledger'])
            self.assertFalse(check(r)[0])
        r = rs.forward_receipt(); del r['mutation_ledger']
        self.assertFalse(check(r)[0])

    def test_binding_fields_must_match(self):
        for field, value in (('release_id', 'old'), ('nonce', 'replay'), ('manifest_hash', 'x' * 64),
                             ('source', 'deadbeef'), ('kind', 'legacy')):
            with self.subTest(field=field):
                r = rs.forward_receipt(); r[field] = value
                self.assertFalse(check(r)[0])

    def test_roles_attester_and_evidence(self):
        cases = {'only admin': dict(roles=['Admin']), 'extra role': dict(roles=['Admin', 'PM', 'Owner']),
                 'worker self-attest': dict(attester='worker@example.invalid'),
                 'unapproved attester': dict(attester='someone@example.invalid'),
                 'no attester': dict(attester=''), 'no evidence': dict(evidence_ids=[]),
                 'blank evidence': dict(evidence_ids=[''])}
        for label, override in cases.items():
            with self.subTest(label):
                self.assertFalse(check(rs.forward_receipt(**override))[0])

    def test_time_window_is_enforced(self):
        self.assertFalse(check(rs.forward_receipt(started_at=900))[0])             # before arming
        self.assertFalse(check(rs.forward_receipt(completed_at=1300), now=1200)[0])  # from the future
        self.assertFalse(check(rs.forward_receipt(), now=2800)[0])                 # evaluated at/after deadline
        self.assertFalse(check(rs.forward_receipt(started_at=1200, completed_at=1100))[0])
        self.assertFalse(check(rs.forward_receipt(started_at=True))[0])

    def test_garbage_input_fails_closed(self):
        for bad in (None, 'receipt', [], 5):
            self.assertFalse(check(bad)[0])
        self.assertFalse(acceptance.validate_receipt(rs.forward_receipt(), kind='other', deadline=1, now=1,
                                                     expected_versions={}, **ARGS)[0])

    def test_input_is_not_mutated(self):
        r = rs.forward_receipt(); before = copy.deepcopy(r); check(r)
        self.assertEqual(r, before)


if __name__ == '__main__':
    unittest.main()
