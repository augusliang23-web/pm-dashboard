"""Regression: removing serialized live clock sampling must fail this test."""
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'pr54-release-runner-20261016'))
from runner import Engine

class ClockSerializationTests(unittest.TestCase):
    def test_interleaved_watchdog_cannot_turn_monotonic_time_into_regression(self):
        with tempfile.TemporaryDirectory() as d:
            e=Engine(Path(d)/'state.db')
            e.prepare();e.watch_tick(1000);e.arm(1000)
            current=[1001.0]
            original=e._reconcile
            def interleave():
                original()
                current[0]=1001.25
                e._guard(current[0],True)
            e._reconcile=interleave
            with patch('runner.time.time',side_effect=lambda:current[0]):
                e.forward_tick()
            state=e.state()
            self.assertEqual(state['mode'],'ACTIVE',state)
            self.assertEqual(state['forward_actions'],1)
            self.assertFalse(state.get('clock_anomaly',False))
            self.assertEqual(e.effect_count('forward','close_legacy'),1)

if __name__=='__main__':unittest.main()
