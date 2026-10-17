#!/usr/bin/env python3
"""Durable PR54 controller. Simulation adapter only; no live cloud backend."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import uuid

PROJECT = 'pm-dashboard-uat-20260820-a7f3'
SOURCE = '4be45fb07dfc6656fcfebedb4874e2488b41e801'
PDF = 'pm-dashboard-uat-pdf-pr60-a560292'
FORWARD = ('close_legacy', 'deploy_attention', 'deploy_save', 'open_endpoints',
           'verify_backend', 'switch_hosting', 'authenticated_smoke', 'verify_normal_operation')
ROLLBACK = ('restore_hosting', 'restore_save', 'restore_attention', 'restore_rules',
            'remove_new_drafts', 'reopen_legacy', 'verify_legacy_authenticated')
TERMINAL = ('SUCCEEDED', 'ROLLED_BACK', 'BLOCKED')


class SimulatedCrash(Exception):
    pass


class FileLock:
    def __init__(self, path):
        self.path = Path(path)
        self.fd = None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fd = open(self.path, 'a+')
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            self.close()
            return False

    def close(self):
        if self.fd:
            self.fd.close()
            self.fd = None


class Engine:
    def __init__(self, path):
        self.path = Path(path).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db() as c:
            c.executescript('''
                CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS provider (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, direction TEXT, step TEXT,
                    status TEXT, effects INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    at REAL, kind TEXT, detail TEXT);
            ''')
        os.chmod(self.path, 0o600)

    @contextmanager
    def db(self):
        c = sqlite3.connect(self.path, timeout=5)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA synchronous=FULL')
        try:
            with c:
                yield c
        finally:
            c.close()

    def _event(self, c, kind, **detail):
        c.execute('INSERT INTO events(at,kind,detail)VALUES(?,?,?)',
                  (time.time(), kind, json.dumps(detail, sort_keys=True)))

    def _get(self, c, table):
        row = c.execute('SELECT data FROM '+table+' WHERE id=1').fetchone()
        if not row:
            raise ValueError('Run is not prepared')
        return json.loads(row['data'])

    def _put(self, c, table, data):
        c.execute('INSERT OR REPLACE INTO '+table+'(id,data)VALUES(1,?)', (json.dumps(data),))

    def state(self):
        with self.db() as c:
            return self._get(c, 'state')

    def provider(self):
        with self.db() as c:
            return self._get(c, 'provider')

    def prepare(self, sha=SOURCE, project=PROJECT, ready=True, artifacts=True,
                baseline=True, adapter='simulation', fail_step='', crash_after_effect='',
                target=1800., forward=2700., hard=3600., heartbeat=60.):
        if (sha != SOURCE or project != PROJECT or not ready or not artifacts or not baseline
                or adapter != 'simulation' or not 0 < target < forward < hard or heartbeat <= 0):
            raise ValueError('Preflight refused: exact UAT source, baseline, rollback, normal-login readiness and simulation required')
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            if c.execute('SELECT 1 FROM state').fetchone():
                raise ValueError('Existing run cannot be overwritten or rearmed')
            s = dict(mode='PREPARED', run_id=str(uuid.uuid4()), project=project, sha=sha,
                     adapter=adapter, evidence='SIMULATED_ONLY', start=None, target_seconds=target,
                     forward_seconds=forward, hard_seconds=hard, heartbeat_seconds=heartbeat,
                     watchdog_heartbeat=None, controller_heartbeat=None, last_now=None,
                     completed=[], acceptance=False, forward_actions=0, escalated=False,
                     fail_step=fail_step, crash_after_effect=crash_after_effect)
            p = dict(hosting='6967bf5354ce4cc5', rules='0ea9132c-0376-4aac-997a-b24cb80bf60f',
                     save='savedashboardproject-00013-yow', attention='setdashboardprojectattention-00010-tix',
                     attention_runtime='nodejs20', max_instances=20, pdf=PDF, weeks=23,
                     archive='unchanged', iam='unchanged', production='untouched', blackout=False,
                     drafts=4, backend_verified=False, authenticated=False, legacy_save_ok=True,
                     attention_ok=True, network=True, unknown_operation=False)
            self._put(c, 'state', s)
            self._put(c, 'provider', p)
            self._event(c, 'PREPARED', source=sha, project=project, adapter=adapter)

    def arm(self, now=None):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            s = self._get(c, 'state')
            now = time.time() if now is None else now
            hb = s['watchdog_heartbeat']
            if s['mode'] != 'PREPARED' or hb is None or not 0 <= now-hb <= s['heartbeat_seconds']:
                raise ValueError('Arming requires prepared run and independent watchdog heartbeat')
            s.update(mode='ACTIVE', start=now, target_deadline=now+s['target_seconds'],
                     forward_deadline=now+s['forward_seconds'], hard_deadline=now+s['hard_seconds'],
                     controller_heartbeat=now, last_now=now)
            self._put(c, 'state', s)
            self._event(c, 'MAINTENANCE_STARTED', start=now, target=s['target_deadline'],
                        forward=s['forward_deadline'], hard=s['hard_deadline'])

    def _abort(self, c, s, reason):
        if s['mode'] in ('ACTIVE', 'PREPARED'):
            s.update(mode='ROLLBACK_REQUESTED', abort_reason=reason)
            self._event(c, 'ROLLBACK_REQUESTED', reason=reason)

    def request_abort(self, reason):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            s = self._get(c, 'state')
            self._abort(c, s, reason)
            self._put(c, 'state', s)

    def fault(self, key, value):
        if key not in ('network', 'unknown_operation'):
            raise ValueError('Unknown simulated provider fault')
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            p = self._get(c, 'provider')
            p[key] = not value if key == 'network' else value
            self._put(c, 'provider', p)

    def events(self):
        with self.db() as c:
            return [dict(seq=r['seq'], at=r['at'], kind=r['kind'], **json.loads(r['detail']))
                    for r in c.execute('SELECT * FROM events ORDER BY seq')]

    def effect_count(self, direction, step):
        with self.db() as c:
            r = c.execute('SELECT sum(effects) n FROM operations WHERE direction=? AND step=?',
                          (direction, step)).fetchone()
            return r['n'] or 0

    def _guard(self, now, watchdog):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            s = self._get(c, 'state')
            # Sample live time only after serializing state access. A timestamp
            # captured before another process committed is not clock regression.
            # Explicit test clocks still retain strict regression detection.
            now = time.time() if now is None else now
            if s['mode'] in TERMINAL:
                return s
            if watchdog:
                s['watchdog_heartbeat'] = now
            else:
                s['controller_heartbeat'] = now
            if s['start'] is not None:
                if now < s['last_now']:
                    s['clock_anomaly'] = True
                    self._abort(c, s, 'clock-regression')
                s['last_now'] = max(now, s['last_now'])
                effective = s['last_now']
                if effective >= s['hard_deadline'] and not s['escalated']:
                    s['escalated'] = True
                    self._event(c, 'ESCALATION', reason='60-minute ceiling exceeded; operator required',
                                deadline=s['hard_deadline'])
                if s['mode'] == 'ACTIVE':
                    if effective >= s['forward_deadline']:
                        self._abort(c, s, 'absolute-forward-deadline')
                    elif effective >= s['target_deadline']:
                        self._abort(c, s, 'normal-service-not-verified-by-target')
                    elif watchdog and effective-s['controller_heartbeat'] > s['heartbeat_seconds']:
                        self._abort(c, s, 'controller-heartbeat-lost')
                    elif not watchdog and effective-s['watchdog_heartbeat'] > s['heartbeat_seconds']:
                        self._abort(c, s, 'watchdog-heartbeat-lost')
                    elif effective >= s['start']+s['target_seconds']*2/3 and not s.get('warned'):
                        s['warned'] = True
                        self._event(c, 'WARNING', reason='20-minute target warning', deadline=s['target_deadline'])
            self._put(c, 'state', s)
            return s

    def _hold_in_transaction(self, c, s, reason):
        count = s.get('retry_count', 0)+1
        delay = min(60, 2**min(count, 6))
        if s['mode'] != 'RECOVERY_HOLD' or s.get('hold_reason') != reason:
            self._event(c, 'RECOVERY_HOLD', reason=reason, operator_required=True)
        s.update(mode='RECOVERY_HOLD', hold_reason=reason, retry_count=count,
                 retry_at=s['last_now']+delay)
        self._put(c, 'state', s)
        self._event(c, 'RETRY_SCHEDULED', retry_at=s['retry_at'], delay=delay)

    def _hold(self, reason):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            s = self._get(c, 'state')
            self._hold_in_transaction(c, s, reason)

    def _reconcile(self):
        with self.db() as c:
            self._event(c, 'PROVIDER_RECONCILE_ATTEMPT')
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            p = self._get(c, 'provider')
            pending = list(c.execute("SELECT * FROM operations WHERE status='INTENT'"))
            if not p['network']:
                raise ConnectionError('provider unreachable')
            if pending and p['unknown_operation']:
                raise ConnectionError('remote operation outcome unknown; no conflicting action permitted')
            for r in pending:
                # Only this simulation adapter can prove no remote effect from
                # its atomic provider store. A live adapter must reconcile the
                # actual provider operation; missing local receipt is insufficient.
                self._event(c, 'RECONCILED', operation=r['id'], outcome='APPLIED' if r['effects'] else 'NOT_APPLIED')
                self._complete(c, r['id'], r['direction'], r['step'], bool(r['effects']))

    def _complete(self, c, opid, direction, step, applied=True):
        s = self._get(c, 'state')
        if applied and direction+':'+step not in s['completed']:
            s['completed'].append(direction+':'+step)
            s.update(retry_at=0, retry_count=0)
            if direction == 'forward':
                s['forward_actions'] += 1
        c.execute('UPDATE operations SET status=? WHERE id=?', ('DONE' if applied else 'ABORTED', opid))
        self._put(c, 'state', s)
        self._event(c, 'OPERATION_VERIFIED', operation=opid, applied=applied)

    def _apply(self, p, step):
        if step == 'close_legacy': p['blackout'] = True
        elif step == 'deploy_attention': p.update(attention='candidate', attention_ok=False)
        elif step == 'deploy_save': p.update(save='candidate', legacy_save_ok=False)
        elif step == 'open_endpoints': p['blackout'] = False
        elif step == 'verify_backend':
            if p['save'] != 'candidate' or p['attention'] != 'candidate' or p['blackout']:
                raise ValueError('backend not operational')
            p['backend_verified'] = True
        elif step == 'switch_hosting': p['hosting'] = 'candidate'
        elif step == 'authenticated_smoke':
            if not p['backend_verified'] or p['hosting'] != 'candidate':
                raise ValueError('authenticated acceptance prerequisites failed')
            p['authenticated'] = True
        elif step == 'verify_normal_operation':
            if not p['authenticated'] or not p['backend_verified'] or p['blackout']:
                raise ValueError('normal operation not proven')
        elif step == 'restore_hosting': p['hosting'] = '6967bf5354ce4cc5'
        elif step == 'restore_save': p.update(save='savedashboardproject-00013-yow', legacy_save_ok=True)
        elif step == 'restore_attention': p.update(attention='setdashboardprojectattention-00010-tix', attention_ok=True)
        elif step == 'restore_rules': p['rules'] = '0ea9132c-0376-4aac-997a-b24cb80bf60f'
        elif step == 'remove_new_drafts': p['drafts'] = 0
        elif step == 'reopen_legacy': p['blackout'] = False
        elif step == 'verify_legacy_authenticated':
            if not p['legacy_save_ok'] or not p['attention_ok'] or p['blackout']:
                raise ValueError('legacy authenticated save/Attention not verified')
        else: raise ValueError('Operation not allowlisted')
        if (p['pdf'] != PDF or p['weeks'] != 23 or p['archive'] != 'unchanged'
                or p['iam'] != 'unchanged' or p['production'] != 'untouched'
                or p['attention_runtime'] != 'nodejs20' or p['max_instances'] != 20):
            raise ValueError('preservation invariant violated')

    def _perform(self, direction, step):
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            s = self._get(c, 'state')
            if direction == 'forward' and s['mode'] != 'ACTIVE':
                return
            if direction == 'rollback':
                s['mode'] = 'ROLLING_BACK'
                self._put(c, 'state', s)
            opid = s['run_id']+':'+direction+':'+step
            row = c.execute('SELECT * FROM operations WHERE id=?', (opid,)).fetchone()
            if row and row['status'] == 'DONE':
                return
            c.execute("INSERT OR REPLACE INTO operations(id,direction,step,status,effects)VALUES(?,?,?,'INTENT',0)", (opid, direction, step))
            self._event(c, 'OPERATION_INTENT', operation=opid, direction=direction, step=step)
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            s = self._get(c, 'state')
            p = self._get(c, 'provider')
            if direction == 'forward' and s['mode'] != 'ACTIVE':
                c.execute("UPDATE operations SET status='ABORTED' WHERE id=?", (opid,))
                self._event(c, 'FORWARD_FENCED', operation=opid)
                return
            if not p['network']:
                raise ConnectionError('provider unreachable')
            if step == s['fail_step']:
                c.execute("UPDATE operations SET status='FAILED' WHERE id=?", (opid,))
                self._event(c, 'OPERATION_FAILED', operation=opid)
                if direction == 'forward':
                    self._abort(c, s, 'operation-failed:'+step)
                    self._put(c, 'state', s)
                else:
                    self._hold_in_transaction(c, s, 'operation-failed:'+step)
                return
            self._apply(p, step)
            self._put(c, 'provider', p)
            c.execute('UPDATE operations SET effects=1 WHERE id=?', (opid,))
            self._event(c, 'PROVIDER_EFFECT', operation=opid, evidence='SIMULATED_ONLY')
            crash = step == s['crash_after_effect']
            if crash:
                s['crash_after_effect'] = ''
                self._put(c, 'state', s)
        if crash:
            raise SimulatedCrash('provider effect committed; receipt confirmation interrupted')
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            self._complete(c, opid, direction, step)

    def _tick_operation(self, direction, now):
        lock = FileLock(self.path.with_suffix('.op.lock'))
        if not lock.acquire():
            return 'BUSY'
        try:
            self._reconcile()
            s = self._guard(now, direction == 'rollback')
            if direction == 'forward' and s['mode'] != 'ACTIVE':
                return 'ABORTED'
            steps = FORWARD if direction == 'forward' else ROLLBACK
            step = next((x for x in steps if direction+':'+x not in s['completed']), None)
            if step:
                self._perform(direction, step)
            s = self.state()
            if all(direction+':'+x in s['completed'] for x in steps):
                with self.db() as c:
                    c.execute('BEGIN IMMEDIATE')
                    s = self._get(c, 'state')
                    p = self._get(c, 'provider')
                    completed_now = time.time() if now is None else now
                    if direction == 'forward':
                        if s['mode'] != 'ACTIVE' or completed_now >= s['target_deadline'] or not p['authenticated'] or not p['backend_verified'] or p['blackout']:
                            self._abort(c, s, 'success-criteria-not-met')
                        else:
                            s.update(mode='SUCCEEDED', acceptance=True, completed_at=completed_now)
                            self._event(c, 'NORMAL_SERVICE_VERIFIED', evidence='SIMULATED_ONLY')
                    else:
                        if p['blackout'] or not p['legacy_save_ok'] or not p['attention_ok']:
                            raise ValueError('rollback not operational')
                        s.update(mode='ROLLED_BACK', completed_at=completed_now)
                        self._event(c, 'ROLLBACK_COMPLETED', evidence='SIMULATED_ONLY', within_ceiling=None if s.get('clock_anomaly') else completed_now < s['hard_deadline'])
                    self._put(c, 'state', s)
            return 'PROGRESS'
        except SimulatedCrash:
            return 'INTERRUPTED'
        except (ConnectionError, ValueError) as exc:
            if direction == 'forward':
                self.request_abort(str(exc))
            else:
                self._hold(str(exc))
            return 'HOLD'
        finally:
            lock.close()

    def forward_tick(self, now=None):
        s = self._guard(now, False)
        if s['mode'] != 'ACTIVE':
            return 'STOPPED'
        return self._tick_operation('forward', now)

    def watch_tick(self, now=None):
        s = self._guard(now, True)
        if s['mode'] == 'RECOVERY_HOLD' and s['last_now'] < s.get('retry_at', 0):
            return 'BACKOFF'
        if s['mode'] in ('ROLLBACK_REQUESTED', 'ROLLING_BACK', 'RECOVERY_HOLD'):
            return self._tick_operation('rollback', now)
        return 'MONITORING'


def serve(engine, role, interval):
    singleton = FileLock(engine.path.with_suffix('.'+role+'.lock'))
    if not singleton.acquire():
        return 73
    try:
        last_alert = 0
        while True:
            s = engine.state()
            if s['mode'] in TERMINAL:
                return 0
            if role == 'watch':
                result = engine.watch_tick()
            elif s['mode'] == 'PREPARED':
                try:
                    engine.arm()
                except ValueError:
                    time.sleep(interval)
                result = 'WAITING'
            elif s['mode'] == 'ACTIVE':
                result = engine.forward_tick()
            else:
                return 0
            if role == 'watch':
                for event in engine.events():
                    if event['seq'] > last_alert and event['kind'] in ('WARNING','RECOVERY_HOLD','ESCALATION'):
                        print(json.dumps(event), file=sys.stderr, flush=True)
                    last_alert = max(last_alert, event['seq'])
            if result == 'INTERRUPTED':
                return 77
            time.sleep(interval)
    finally:
        singleton.close()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['prepare-demo','controller','watchdog','status','launch-demo'])
    p.add_argument('database', type=Path)
    p.add_argument('--ending', choices=['killed','quota'], default='quota')
    p.add_argument('--interval', type=float, default=.1)
    args = p.parse_args()
    if args.interval <= 0:
        p.error('interval must be positive')
    e = Engine(args.database)
    if args.action in ('prepare-demo', 'launch-demo'):
        # Demo clock scales only mock deadlines. No live adapter exists.
        e.prepare(fail_step='authenticated_smoke', target=3, forward=4.5, hard=6, heartbeat=.8)
    if args.action == 'prepare-demo':
        print(json.dumps(e.state()))
    elif args.action == 'status':
        print(json.dumps({'state': e.state(), 'provider': e.provider(), 'events': e.events()}, indent=2))
    elif args.action in ('controller','watchdog'):
        return serve(e, 'watch' if args.action=='watchdog' else 'controller', args.interval)
    else:
        children = []
        handles = []
        for role in ('watchdog','controller'):
            f = open(e.path.with_suffix('.'+role+'.log'), 'ab')
            handles.append(f)
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), role, str(e.path), '--interval', '.03'],
                                     stdin=subprocess.DEVNULL, stdout=f, stderr=f, start_new_session=True, close_fds=True)
            children.append(child)
        print(json.dumps({'watchdog':children[0].pid,'controller':children[1].pid,'launcher':os.getpid()}), flush=True)
        for f in handles:
            f.close()
        if args.ending=='quota':
            return 75
        while True:
            time.sleep(1)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
