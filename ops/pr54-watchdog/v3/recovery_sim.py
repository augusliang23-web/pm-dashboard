"""Local recovery simulation: fake Cloud Run provider + v3 coordinator + rollback adapter.

SIMULATED ONLY. Everything here is in-memory; it proves protocol behaviour of this
code against a *model* of the provider, never behaviour of real Google Cloud.
The fake models documented Cloud Run v2 shapes (etag, traffic vs trafficStatuses,
long-running operations, validateOnly) and is only as faithful as that model.
"""
from copy import deepcopy
import hashlib
from pathlib import Path
import re
import sys
import threading
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from coordinator_v3 import CoordinatorV3, StepVerifiers  # noqa: E402
from cloud_run_rollback import (CloudRunRollback, SERVICES, REVISION_TYPE, HOST, PROJECT, REGION,  # noqa: E402
                                revision_fingerprint, service_static_fingerprint,
                                Drift, Preflight)
from cloud_bridge import Missing, Conflict, Unavailable, Denied, REQUIRED_CHECKS  # noqa: E402
from runner import ROLLBACK, SOURCE  # noqa: E402
import acceptance  # noqa: E402

BASE = 'projects/%s/locations/%s/' % (PROJECT, REGION)
VERSIONS_BASELINE = dict(hosting='6967bf5354ce4cc5', rules='0ea9132c-0376-4aac-997a-b24cb80bf60f',
                         save='savedashboardproject-00013-yow', attention='setdashboardprojectattention-00010-tix')
VERSIONS_CANDIDATE = dict(hosting='candidate-hosting', rules='candidate-rules',
                          save='savedashboardproject-00014-new', attention='setdashboardprojectattention-00011-new')


class MemoryStore:
    """Generation-CAS object store with the same Missing/Conflict/Denied/Unavailable semantics as GcsStore."""
    def __init__(self):
        self.gen, self.value, self.lock, self.fail = 0, None, threading.Lock(), None
    def read(self):
        if self.fail == 'network': raise Unavailable()
        if self.fail == 'permission': raise Denied()
        if self.value is None: raise Missing()
        return self.gen, deepcopy(self.value)
    def cas(self, generation, value):
        with self.lock:
            if self.fail == 'network': raise Unavailable()
            if self.fail == 'permission': raise Denied()
            if generation != self.gen: raise Conflict()
            self.gen += 1; self.value = deepcopy(value); return self.gen


class FakeReceipts:
    def __init__(self):
        self.forward = self.legacy = None
    def read(self, release_id):
        if self.forward is None: raise Missing()
        return deepcopy(self.forward)
    def read_legacy(self, release_id):
        if self.legacy is None: raise Missing()
        return deepcopy(self.legacy)


class FakeCloudRun:
    """Model of the two backing Cloud Run services. Mutations only via request(); no side channel."""
    def __init__(self):
        self.calls, self.fail, self.lose_next_patch, self.fail_ops = [], None, False, False
        self.drop_next_patch, self.applied = False, []
        self.seq, self.ops, self.revisions, self.services, self.iam = 0, {}, {}, {}, {}
        for step, (svc, base) in SERVICES.items():
            cand = {'restore_save': VERSIONS_CANDIDATE['save'], 'restore_attention': VERSIONS_CANDIDATE['attention']}[step]
            for rev in (base, cand):
                self.revisions[(svc, rev)] = dict(
                    name=BASE + 'services/%s/revisions/%s' % (svc, rev),
                    serviceAccount='sa-%s@%s.iam.gserviceaccount.com' % (svc, PROJECT),
                    containers=[dict(image='image-' + rev, env=[dict(name='NODE_ENV', value='production')])],
                    scaling=dict(maxInstanceCount=20),
                    conditions=[dict(type='Ready', state='CONDITION_SUCCEEDED')])
            t = [dict(type=REVISION_TYPE, revision=cand, percent=100)]
            self.services[svc] = dict(name=BASE + 'services/' + svc, ingress='INGRESS_TRAFFIC_ALL',
                                      invokerIamDisabled=True, traffic=deepcopy(t), trafficStatuses=deepcopy(t),
                                      etag='etag-1', reconciling=False,
                                      terminalCondition=dict(state='CONDITION_SUCCEEDED'))
            self.iam[svc] = dict(bindings=[])

    def baselines(self):
        out = {}
        for step, (svc, base) in SERVICES.items():
            out[step] = dict(revision_fingerprint=revision_fingerprint(self.revisions[(svc, base)]),
                             service_fingerprint=service_static_fingerprint(self.services[svc], self.iam[svc]))
        return out

    def patches(self):
        return [c for c in self.calls if c[0] == 'PATCH' and 'validateOnly' not in c[2]]

    def advance(self):
        """Let pending long-running operations finish."""
        for op in self.ops.values():
            if op['done']: continue
            op['done'] = True
            svc = self.services[op['service']]
            if self.fail_ops:
                op['error'] = dict(code=13); svc['traffic'] = deepcopy(op['previous'])
            else:
                svc['trafficStatuses'] = deepcopy(svc['traffic'])
            svc['reconciling'] = False

    def request(self, method, url, body=None):
        assert url.startswith(HOST), url  # nothing outside the Cloud Run v2 host can be built
        parts = urlsplit(url[len(HOST):])
        path, query = parts.path, parse_qs(parts.query)
        self.calls.append((method, path, parts.query, deepcopy(body)))
        if self.fail == 'deny': return 403, {}
        if self.fail == 'network': return 503, {}
        m = re.fullmatch(re.escape(BASE) + r'services/([a-z0-9-]+)(:getIamPolicy|/revisions/([a-z0-9-]+))?', path)
        if m and m.group(1) in self.services:
            svc = self.services[m.group(1)]
            if m.group(2) == ':getIamPolicy' and method == 'GET': return 200, deepcopy(self.iam[m.group(1)])
            if m.group(3) and method == 'GET':
                rev = self.revisions.get((m.group(1), m.group(3)))
                return (200, deepcopy(rev)) if rev else (404, {})
            if m.group(2) is None and method == 'GET': return 200, deepcopy(svc)
            if m.group(2) is None and method == 'PATCH': return self._patch(m.group(1), svc, query, body)
        m = re.fullmatch(re.escape(BASE) + r'operations/([A-Za-z0-9_-]+)', path)
        if m and method == 'GET':
            op = self.ops.get(BASE + 'operations/' + m.group(1))
            if not op: return 404, {}
            out = dict(name=BASE + 'operations/' + m.group(1), done=op['done'])
            if op.get('error'): out['error'] = op['error']
            return 200, out
        return 400, {}

    def _patch(self, name, svc, query, body):
        if query.get('updateMask') != ['traffic']: return 400, {}      # only a traffic mask is ever accepted
        if not isinstance(body, dict) or set(body) - {'name', 'traffic', 'etag'}: return 400, {}
        if body.get('etag') != svc['etag']: return 409, {}
        if query.get('validateOnly') == ['true']: return 200, dict(name=svc['name'], validateOnly=True)
        if self.drop_next_patch:                                          # request never reached the provider
            self.drop_next_patch = False
            return 503, {}
        previous = deepcopy(svc['traffic'])
        svc['traffic'] = deepcopy(body['traffic'])
        self.applied.append(name)                                         # mutations that actually took effect
        self.seq += 1
        svc['etag'], svc['reconciling'] = 'etag-%d' % (self.seq + 1), True
        op = BASE + 'operations/op%d' % self.seq
        self.ops[op] = dict(done=False, service=name, previous=previous)
        return (503, {}) if self.lose_next_patch else (200, dict(name=op))   # response lost AFTER the mutation applied


def legacy_receipt(release='rel-1', nonce='nonce-1', manifest='m' * 64, now=1500.0, **override):
    r = dict(kind='legacy', release_id=release, nonce=nonce, manifest_hash=manifest, source=SOURCE,
             started_at=now - 60, completed_at=now, roles=['Admin', 'PM'],
             checks={k: True for k in acceptance.LEGACY_CHECKS}, versions=dict(VERSIONS_BASELINE),
             mutation_ledger=dict(unexpected_writes=0, synthetic_ids_only=True, historical_or_archive_writes=0),
             evidence_ids=['ev-1'], attester='attester@example.invalid')
    r.update(override)
    return r


def forward_receipt(release='rel-1', nonce='nonce-1', manifest='m' * 64, now=1100.0, **override):
    r = legacy_receipt(release, nonce, manifest, now)
    r.update(kind='forward', versions=dict(VERSIONS_CANDIDATE),
             checks={k: True for k in acceptance.FORWARD_CHECKS})
    r.update(override)
    return r


class Sim:
    """One world: store + fake Cloud Run + receipts. Coordinators/adapters can be 'restarted' freely."""
    def __init__(self, release='rel-1', nonce='nonce-1', start=1000.0, etag_semantics_validated=False):
        self.release, self.nonce, self.start = release, nonce, start
        self.manifest_hash, self.baseline_hash = 'm' * 64, 'b' * 64
        self.store, self.run, self.receipts = MemoryStore(), FakeCloudRun(), FakeReceipts()
        self.other, self.now, self.infra_ok = set(), start, True
        self.etag_semantics_validated = etag_semantics_validated
        self.unsubmitted, self.errors = [], []
        self.coord = self.make_coord('exec-A')

    def make_coord(self, owner):
        adapter = CloudRunRollback(self.run.request, self.run.baselines(), self.etag_semantics_validated)
        c = CoordinatorV3(self.store, self.receipts, self.release, self.nonce, self.start,
                          lambda a: 'UNKNOWN', lambda: self.infra_ok, owner, self.manifest_hash, self.baseline_hash,
                          VERSIONS_CANDIDATE, VERSIONS_BASELINE, attesters={'attester@example.invalid'},
                          worker_principals=('worker@example.invalid',))
        other = lambda a: 'DONE_VERIFIED' if a['step'] in self.other else 'UNKNOWN'
        c.operation_verifier = StepVerifiers({
            'restore_save': adapter.verify, 'restore_attention': adapter.verify,
            'restore_hosting': other, 'restore_rules': other, 'remove_new_drafts': other, 'reopen_legacy': other,
            'verify_legacy_authenticated': c.legacy_receipt_step(lambda: self.now)})
        c.adapter = adapter
        return c

    def tick(self, c=None):
        """One Workflows-loop iteration. Returns a short status string."""
        c = c or self.coord
        s = c.state()
        if s['mode'] in ('SUCCEEDED', 'ROLLED_BACK'): return 'TERMINAL'
        if s['inflight']:
            c.reconcile(); return 'RECONCILED'
        c.watch(self.now)
        s = c.state()
        if s['mode'] not in ('ROLLBACK_REQUESTED', 'ROLLING_BACK', 'RECOVERY_HOLD'): return s['mode']
        step = next((x for x in ROLLBACK if 'rollback:' + x not in s['completed']), None)
        g = c.claim_rollback(step, self.now)
        if not g.get('execute'): return g['reason']
        return self._perform(c, step, g)

    def _perform(self, c, step, g):
        if step in SERVICES:
            try:
                op = c.adapter.submit(step, g, lambda etag: c.ack_submission(g['action_id'], etag))
            except Unavailable as exc:
                return self._submit_failed(c, g, exc, None)
            except (Drift, Preflight, Denied) as exc:
                return self._submit_failed(c, g, exc, {Drift: 'DRIFT', Preflight: 'PREFLIGHT_REJECTED', Denied: 'PERMISSION_DENIED'}[type(exc)])
            except Conflict as exc:
                return self._submit_failed(c, g, exc, None)
            if op: c.ack_operation(g['action_id'], op)
            return 'SUBMITTED'
        if step != 'verify_legacy_authenticated':
            self.other.add(step)
        return 'SUBMITTED'

    def _submit_failed(self, c, g, exc, hold):
        self.errors.append(type(exc).__name__)
        pre = c.state()['inflight']
        if pre and not pre.get('pre_etag') and not pre.get('operation'):
            c.release_unsubmitted(g['action_id'], type(exc).__name__.upper())   # provably never submitted
            if hold: c.hold(hold)
            return 'RELEASED'
        return 'AMBIGUOUS'   # persisted precondition, outcome unknown: stays fenced until reconciled

    def arm_and_request_rollback(self):
        self.coord.arm()
        self.now = self.start + 1801          # no verified success by T+30 -> rollback
        self.coord.watch(self.now)

    def drive(self, c=None, max_ticks=60, advance=True):
        for _ in range(max_ticks):
            if advance: self.run.advance()
            if self.tick(c) == 'TERMINAL': return True
        return False
