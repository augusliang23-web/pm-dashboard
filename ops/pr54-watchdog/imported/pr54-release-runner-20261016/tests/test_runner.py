import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'release.db'

    def engine(self, **kw):
        from runner import Engine
        e = Engine(self.path)
        e.prepare(**kw)
        e.watch_tick(1000)
        e.arm(1000)
        return e

    def finish_recovery(self, e, now=1002):
        for _ in range(30):
            e.watch_tick(now)
            if e.state()['mode'] == 'ROLLED_BACK':
                break
        self.assertEqual(e.state()['mode'], 'ROLLED_BACK')
        self.assertTrue(e.provider()['legacy_save_ok'])
        self.assertTrue(e.provider()['attention_ok'])
        self.assertEqual(e.provider()['pdf'], 'pm-dashboard-uat-pdf-pr60-a560292')
        self.assertEqual(e.provider()['weeks'], 23)

    def test_hosting_alone_never_completes_release(self):
        e = self.engine()
        for _ in range(6):
            e.forward_tick(1001)
        self.assertEqual(e.provider()['hosting'], 'candidate')
        self.assertEqual(e.state()['mode'], 'ACTIVE')
        self.assertFalse(e.state()['acceptance'])
        e.watch_tick(2800)
        self.finish_recovery(e, 2800)

    def test_smoke_failure_requests_rollback(self):
        e = self.engine(fail_step='authenticated_smoke')
        for _ in range(12):
            e.forward_tick(1001)
        self.assertEqual(e.state()['mode'], 'ROLLBACK_REQUESTED')
        self.finish_recovery(e)

    def test_deployment_failure_requests_rollback(self):
        e = self.engine(fail_step='deploy_save')
        for _ in range(4):
            e.forward_tick(1001)
        self.finish_recovery(e)
        self.assertNotEqual(e.provider()['save'], 'candidate')

    def test_absolute_deadlines_survive_restart_and_rearm_rejected(self):
        from runner import Engine
        e = self.engine()
        original = e.state()['start']
        other = Engine(self.path)
        with self.assertRaises(ValueError):
            other.arm(2000)
        self.assertEqual(other.state()['start'], original)
        other.watch_tick(3700)
        self.finish_recovery(other, 3700)
        self.assertEqual(other.state()['forward_actions'], 0)

    def test_network_loss_holds_then_recovers_without_forward_retry(self):
        e = self.engine()
        e.forward_tick(1001)
        e.fault('network', True)
        e.request_abort('network failure')
        e.watch_tick(4601)
        self.assertEqual(e.state()['mode'], 'RECOVERY_HOLD')
        self.assertTrue(e.state()['escalated'])
        self.assertFalse(e.state()['acceptance'])
        e.fault('network', False)
        self.finish_recovery(e, 4604)

    def test_interrupted_rollback_reconciles_without_duplicate_effect(self):
        from runner import Engine
        e = self.engine(crash_after_effect='restore_save')
        e.request_abort('smoke failed')
        for _ in range(4):
            e.watch_tick(1001)
        e2 = Engine(self.path)
        self.finish_recovery(e2)
        self.assertEqual(e2.effect_count('rollback', 'restore_save'), 1)
        self.assertTrue(any(x['kind']=='RECONCILED' for x in e2.events()))

    def test_unknown_remote_operation_does_not_start_conflicting_rollback(self):
        e = self.engine(crash_after_effect='deploy_attention')
        e.forward_tick(1001)
        e.forward_tick(1001)
        e.fault('unknown_operation', True)
        e.request_abort('timeout')
        e.watch_tick(1002)
        self.assertEqual(e.state()['mode'], 'RECOVERY_HOLD')
        self.assertEqual(e.effect_count('rollback', 'restore_hosting'), 0)
        e.fault('unknown_operation', False)
        self.finish_recovery(e, 1005)

    def test_double_watchdog_uses_singleton_lock(self):
        from runner import FileLock
        a = FileLock(self.path.with_suffix('.watch.lock'))
        b = FileLock(self.path.with_suffix('.watch.lock'))
        self.assertTrue(a.acquire())
        self.addCleanup(a.close)
        self.assertFalse(b.acquire())
        b.close()

    def test_operation_lock_does_not_prevent_persisting_abort_intent(self):
        from runner import FileLock
        e = self.engine()
        lock = FileLock(self.path.with_suffix('.op.lock'))
        self.assertTrue(lock.acquire())
        try:
            e.watch_tick(2800)
            self.assertEqual(e.state()['mode'], 'ROLLBACK_REQUESTED')
            self.assertEqual(e.effect_count('rollback', 'restore_hosting'), 0)
            e.forward_tick(2801)
            self.assertEqual(e.state()['forward_actions'], 0)
        finally:
            lock.close()
        self.finish_recovery(e, 2801)

    def test_success_requires_all_verification_and_restores_normal_operation(self):
        e = self.engine()
        for _ in range(15):
            e.forward_tick(1001)
        s = e.state()
        self.assertEqual(s['mode'], 'SUCCEEDED')
        self.assertTrue(s['acceptance'])
        self.assertFalse(e.provider()['blackout'])
        self.assertTrue(e.provider()['backend_verified'])
        self.assertTrue(e.provider()['authenticated'])

    def test_baseline_or_readiness_mismatch_never_arms(self):
        from runner import Engine
        for kw in [{'sha':'wrong'}, {'project':'production'}, {'ready':False}, {'artifacts':False}, {'baseline':False}, {'adapter':'live'}]:
            with self.subTest(kw=kw):
                p = Path(self.tmp.name) / (str(len(list(Path(self.tmp.name).iterdir())))+'.db')
                e = Engine(p)
                with self.assertRaises(ValueError):
                    e.prepare(**kw)

    def test_no_watchdog_heartbeat_blocks_start(self):
        from runner import Engine
        e = Engine(self.path)
        e.prepare()
        with self.assertRaises(ValueError):
            e.arm(1000)

    def test_clock_regression_stops_forward_and_warn_is_persisted(self):
        e = self.engine()
        from runner import FileLock
        busy = FileLock(self.path.with_suffix('.op.lock'))
        self.assertTrue(busy.acquire())
        try:
            for now in range(1030, 2201, 30):
                e.watch_tick(now)
                e.forward_tick(now)
        finally:
            busy.close()
        self.assertTrue(any(x['kind']=='WARNING' for x in e.events()))
        e.forward_tick(2000)
        self.assertNotEqual(e.state()['mode'], 'ACTIVE')
        self.assertTrue(e.state().get('clock_anomaly'))
        self.finish_recovery(e, 2201)
        completed = next(x for x in e.events() if x['kind']=='ROLLBACK_COMPLETED')
        self.assertIsNone(completed['within_ceiling'])


    def test_network_retries_obey_persisted_backoff(self):
        from runner import Engine
        e = self.engine()
        e.fault('network', True)
        e.request_abort('network')
        e.watch_tick(1001)
        self.assertEqual(e.state().get('retry_at'), 1003)
        count = len(e.events())
        restarted = Engine(self.path)
        restarted.watch_tick(1002)
        self.assertEqual(len(restarted.events()), count)
        e.fault('network', False)
        self.finish_recovery(restarted, 1004)


class DetachedProcessTests(unittest.TestCase):
    def test_session_exit_and_quota_exit_leave_recovery_process_running(self):
        for ending in ['killed', 'quota']:
            with self.subTest(ending=ending), tempfile.TemporaryDirectory() as d:
                db = Path(d)/'state.db'
                launch = subprocess.Popen([sys.executable,str(ROOT/'runner.py'),'launch-demo',str(db),'--ending',ending],stdout=subprocess.PIPE,text=True)
                info = json.loads(launch.stdout.readline())
                try:
                    if ending == 'killed':
                        launch.kill()
                    launch.wait(timeout=5)
                    # Parent/session is gone. The detached controller fails its
                    # simulated smoke; the separately running watchdog recovers.
                    limit = time.monotonic()+10
                    from runner import Engine
                    e = Engine(db)
                    while time.monotonic()<limit and e.state()['mode']!='ROLLED_BACK':
                        time.sleep(.03)
                    self.assertEqual(e.state()['mode'],'ROLLED_BACK')
                    self.assertTrue(e.provider()['legacy_save_ok'])
                    self.assertTrue(e.provider()['attention_ok'])
                    self.assertTrue(any(x['kind']=='ROLLBACK_COMPLETED' for x in e.events()))
                    self.assertNotEqual(info['watchdog'], launch.pid)
                    self.assertNotEqual(info['controller'], launch.pid)
                finally:
                    for pid in [info['controller'],info['watchdog']]:
                        try:os.kill(pid,15)
                        except ProcessLookupError:pass
                    launch.stdout.close()


    def spawn(self, role, db, interval='.03'):
        child = subprocess.Popen([sys.executable,str(ROOT/'runner.py'),role,str(db),'--interval',interval], stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        def cleanup():
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=5)
        self.addCleanup(cleanup)
        return child

    def until(self, predicate):
        end = time.monotonic()+5
        while time.monotonic()<end:
            if predicate():
                return
            time.sleep(.01)
        self.fail('Expected process evidence did not arrive within5s')

    def test_killed_controller_is_recovered_by_separate_watchdog(self):
        from runner import Engine
        with tempfile.TemporaryDirectory() as d:
            db=Path(d)/'state.db'
            e=Engine(db)
            e.prepare(target=3, forward=4.5, hard=6, heartbeat=.3)
            watch=self.spawn('watchdog',db)
            controller=self.spawn('controller',db,'.1')
            self.until(lambda: e.state()['forward_actions']>=1)
            controller.kill()
            controller.wait(timeout=5)
            self.until(lambda: e.state()['mode']=='ROLLED_BACK')
            self.assertEqual(e.state()['abort_reason'],'controller-heartbeat-lost')
            self.assertTrue(e.provider()['legacy_save_ok'])
            self.assertFalse(e.provider()['blackout'])
            watch.wait(timeout=5)

    def test_duplicate_watchdog_process_exits_without_taking_over(self):
        from runner import Engine
        with tempfile.TemporaryDirectory() as d:
            db=Path(d)/'state.db'
            e=Engine(db)
            e.prepare()
            first=self.spawn('watchdog',db)
            self.until(lambda:e.state()['watchdog_heartbeat'] is not None)
            duplicate=self.spawn('watchdog',db)
            self.assertEqual(duplicate.wait(timeout=5),73)
            self.assertIsNone(first.poll())
            self.assertEqual(e.state()['mode'],'PREPARED')
            first.terminate()
            first.wait(timeout=5)

    def test_interrupted_recovery_process_resumes_provider_receipt(self):
        from runner import Engine
        with tempfile.TemporaryDirectory() as d:
            db=Path(d)/'state.db'
            e=Engine(db)
            e.prepare(crash_after_effect='restore_save')
            e.watch_tick()
            e.arm()
            e.request_abort('smoke failure')
            old=self.spawn('watchdog',db)
            self.assertEqual(old.wait(timeout=5),77)
            self.assertEqual(e.effect_count('rollback','restore_save'),1)
            new=self.spawn('watchdog',db)
            self.until(lambda:e.state()['mode']=='ROLLED_BACK')
            new.wait(timeout=5)
            self.assertEqual(e.effect_count('rollback','restore_save'),1)
            self.assertTrue(any(x['kind']=='RECONCILED' for x in e.events()))


if __name__ == '__main__':
    unittest.main()
