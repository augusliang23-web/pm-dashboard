"""Authenticated acceptance contract (v3). Pure validation; performs no I/O.

A receipt is produced by a trusted, separately approved attester using a real
normal login. This module only decides whether a receipt is *sufficient*. It
cannot prove the attester told the truth: that remains a human/process control.
Hosting deployment, worker status strings and runner booleans never satisfy it.
"""

# Forward (PR54 cutover) acceptance. Superset of the v2 prototype checks.
FORWARD_CHECKS = (
    'firebase_auth', 'pm_ownership', 'legacy_pm_save', 'attention',
    'save_draft', 'save_publish', 'overview_pdf', 'released_protection',
    'archive_preservation', 'backend_operation', 'unauthorized_rejected',
    'no_unexpected_mutation', 'versions_match',
)
# Legacy restoration acceptance (after rollback). PR54-only Draft endpoints are
# not deployed after rollback, so they must NOT be required here.
LEGACY_CHECKS = (
    'firebase_auth', 'pm_ownership', 'legacy_pm_save', 'attention',
    'unauthorized_rejected', 'no_unexpected_mutation', 'versions_match',
    'pdf_preserved', 'archive_preservation',
)
EXPECTED_ROLES = {'Admin', 'PM'}
VERSION_KEYS = ('hosting', 'rules', 'save', 'attention')


def validate_receipt(receipt, *, kind, release_id, nonce, manifest_hash, source,
                     start, deadline, now, expected_versions, attesters=None,
                     worker_principals=()):
    """Return (ok, reasons). Fails closed on any missing or malformed field."""
    reasons = []
    checks_required = {'forward': FORWARD_CHECKS, 'legacy': LEGACY_CHECKS}.get(kind)
    if checks_required is None:
        return False, ['unknown receipt kind']
    if not isinstance(receipt, dict):
        return False, ['receipt missing or not an object']
    if receipt.get('kind') != kind:
        reasons.append('kind mismatch')
    for field, want in (('release_id', release_id), ('nonce', nonce),
                        ('manifest_hash', manifest_hash), ('source', source)):
        if receipt.get(field) != want:
            reasons.append(field + ' mismatch')
    if set(receipt.get('roles', [])) != EXPECTED_ROLES:
        reasons.append('Admin and PM normal-login roles both required')
    s, c = receipt.get('started_at'), receipt.get('completed_at')
    if not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (s, c)):
        reasons.append('test times missing')
    elif not (start <= s <= c <= now < deadline):
        reasons.append('test times outside armed window')
    checks = receipt.get('checks')
    if not isinstance(checks, dict):
        reasons.append('checks missing')
        checks = {}
    missing = [k for k in checks_required if checks.get(k) is not True]
    if missing:
        reasons.append('checks not proven: ' + ','.join(missing))
    versions = receipt.get('versions')
    if not isinstance(versions, dict) or any(
            versions.get(k) != expected_versions.get(k) or not expected_versions.get(k)
            for k in VERSION_KEYS):
        reasons.append('observed versions differ from manifest')
    ledger = receipt.get('mutation_ledger')
    if (not isinstance(ledger, dict) or ledger.get('unexpected_writes') != 0
            or ledger.get('synthetic_ids_only') is not True
            or ledger.get('historical_or_archive_writes') != 0):
        reasons.append('mutation ledger not clean')
    evidence = receipt.get('evidence_ids')
    if not isinstance(evidence, list) or not evidence or not all(isinstance(x, str) and x for x in evidence):
        reasons.append('evidence ids missing')
    attester = receipt.get('attester')
    if not isinstance(attester, str) or not attester:
        reasons.append('attester missing')
    elif attester in set(worker_principals):
        reasons.append('worker may not attest its own release')
    elif attesters is not None and attester not in attesters:
        reasons.append('attester not on approved list')
    return (not reasons), reasons
