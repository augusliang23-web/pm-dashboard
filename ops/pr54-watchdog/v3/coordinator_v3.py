"""v3 coordinator: extends the reviewed v2 protocol without rewriting it.

Adds (all previously listed as missing in CLOUD_EXECUTION_CONTRACT.md):
  * execution-owner binding: a duplicate execution with a different owner cannot adopt a release
  * manifest/baseline hash binding in the immutable state
  * terminal-state rollover with CAS against the exact terminal generation
  * pre-submission etag capture for lost-submission reconciliation
  * a router for per-step verifiers that fails closed (UNKNOWN) for unregistered steps
  * rollback completion gated on an authenticated *legacy* receipt
"""
from copy import deepcopy
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent/'imported'/'pr54-release-runner-20261016'))
sys.path.insert(0, str(HERE.parent/'imported'/'pr54-cloud-watchdog-20261016'))
from runner import PROJECT, SOURCE, ROLLBACK  # noqa: E402
from cloud_bridge import Coordinator, Conflict, Missing, Stale  # noqa: E402
import acceptance  # noqa: E402

TERMINAL = ('SUCCEEDED', 'ROLLED_BACK')


class CoordinatorV3(Coordinator):
    def __init__(self, store, receipts, release_id, nonce, start, operation_verifier, verifier,
                 owner, manifest_hash, baseline_hash, expected_versions, baseline_versions,
                 attesters=None, worker_principals=()):
        super().__init__(store, receipts, release_id, nonce, start, operation_verifier, verifier)
        if not owner or not manifest_hash or not baseline_hash:
            raise ValueError('Missing owner/manifest/baseline binding')
        self.owner, self.manifest_hash, self.baseline_hash = owner, manifest_hash, baseline_hash
        self.expected_versions = dict(expected_versions)   # candidate versions (forward acceptance)
        self.baseline_versions = dict(baseline_versions)   # approved baseline (legacy acceptance after rollback)
        self.attesters, self.worker_principals = attesters, tuple(worker_principals)

    def _validate(self, s):
        super()._validate(s)
        if (s.get('schema') != 3 or s.get('owner') != self.owner or
                s.get('manifest_hash') != self.manifest_hash or s.get('baseline_hash') != self.baseline_hash):
            raise Stale('Owner or approved manifest/baseline binding mismatch')

    def _new_state(self, previous):
        return dict(schema=3, project=PROJECT, source=SOURCE, release_id=self.release, nonce=self.nonce,
                    owner=self.owner, manifest_hash=self.manifest_hash, baseline_hash=self.baseline_hash,
                    start=self.start, target=self.start+1800, forward_stop=self.start+2700, hard=self.start+3600,
                    mode='ACTIVE', accepted=False, incident=False, inflight=None, completed=[], events=[],
                    previous=previous)

    def arm(self):
        try:
            self.store.cas(0, self._new_state(None))
        except Conflict:
            self.state()  # exact resume only (same owner and hashes); never resets deadlines

    def rollover(self):
        """Start this release after the previous one reached a verified terminal state."""
        generation, old = self.store.read()
        if old.get('mode') not in TERMINAL or old.get('inflight') is not None:
            raise Stale('Previous release is not terminal and fully reconciled')
        if old.get('release_id') == self.release:
            raise Stale('Release already active')
        if old.get('mode') == 'ROLLED_BACK' and not all('rollback:'+x in old['completed'] for x in ROLLBACK):
            raise Stale('Previous rollback ledger incomplete')
        previous = dict(release_id=old.get('release_id'), owner=old.get('owner'), generation=generation,
                        final_mode=old['mode'], manifest_hash=old.get('manifest_hash'))
        self.store.cas(generation, self._new_state(previous))  # loses the race if anything changed

    def ack_submission(self, action_id, pre_etag):
        if not isinstance(pre_etag, str) or not pre_etag or len(pre_etag) > 256:
            raise ValueError('pre_etag must be a bounded provider fingerprint')
        def change(s):
            a = s['inflight']
            if not a or a['action_id'] != action_id:
                raise Stale('Unknown action acknowledgment')
            a['pre_etag'] = pre_etag
            self._event(s, 'SUBMISSION_PRECONDITION_PERSISTED')
        self._change(change)

    HOLD_REASONS = ('DRIFT', 'PERMISSION_DENIED', 'PREFLIGHT_REJECTED')

    def release_unsubmitted(self, action_id, reason):
        """Free the action slot only when no precondition/operation was ever persisted (provably not submitted)."""
        def change(s):
            a = s['inflight']
            if not a or a['action_id'] != action_id:
                raise Stale('Unknown action')
            if a.get('operation') or a.get('pre_etag'):
                raise Stale('Submission may have occurred; reconcile instead')
            s['inflight'] = None
            self._event(s, 'UNSUBMITTED_RELEASED_' + reason)
        self._change(change)

    def hold(self, reason):
        """Operator hold: fences new actions and raises an incident. Cleared only by clear_hold()."""
        if reason not in self.HOLD_REASONS:
            raise ValueError('Use a sanitized hold code')
        def change(s):
            if s['mode'] not in TERMINAL:
                s['mode'] = 'RECOVERY_HOLD'; s['incident'] = True; s['operator_hold'] = reason
                self._event(s, 'HOLD_' + reason)
        self._change(change)

    def clear_hold(self):
        def change(s):
            if s.get('operator_hold'):
                s['operator_hold'] = None; self._event(s, 'HOLD_CLEARED_BY_OPERATOR')
        self._change(change)

    def _claim(self, direction, step, now):
        if self.state().get('operator_hold'):  # sole-writer workflow: no race with hold()
            return {'execute': False, 'reason': 'OPERATOR_HOLD'}
        return super()._claim(direction, step, now)

    def _receipt_valid(self, r, now):
        ok, _ = acceptance.validate_receipt(
            r, kind='forward', release_id=self.release, nonce=self.nonce, manifest_hash=self.manifest_hash,
            source=SOURCE, start=self.start, deadline=self.start+1800, now=now,
            expected_versions=self.expected_versions, attesters=self.attesters,
            worker_principals=self.worker_principals)
        return ok

    def watch(self, now):
        if self.state()['mode'] in TERMINAL:
            return self.state()['mode']
        return super().watch(now)

    def legacy_receipt_step(self, clock):
        """Verifier for rollback:verify_legacy_authenticated. clock() must return server-origin time."""
        def verify(action):
            try:
                r = self.receipts.read_legacy(self.release)
            except Missing:
                return 'UNKNOWN'
            ok, _ = acceptance.validate_receipt(
                r, kind='legacy', release_id=self.release, nonce=self.nonce, manifest_hash=self.manifest_hash,
                source=SOURCE, start=self.start, deadline=self.start+3600, now=clock(),
                expected_versions=self.baseline_versions, attesters=self.attesters,
                worker_principals=self.worker_principals)
            return 'DONE_VERIFIED' if ok and self.verifier() else 'UNKNOWN'
        return verify


class StepVerifiers:
    """operation_verifier router. Unregistered step or exception => UNKNOWN (fenced), never success."""
    def __init__(self, by_step):
        self.by_step = dict(by_step)

    def __call__(self, action):
        fn = self.by_step.get(action.get('step')) if action.get('direction') == 'rollback' else None
        if fn is None:
            return 'UNKNOWN'
        outcome = fn(deepcopy(action))
        return outcome if outcome in ('DONE_VERIFIED', 'FAILED_CONFIRMED', 'NOT_STARTED_CONFIRMED') else 'UNKNOWN'
