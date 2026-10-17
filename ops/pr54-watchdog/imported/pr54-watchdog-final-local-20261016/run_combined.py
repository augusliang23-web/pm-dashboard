#!/usr/bin/env python3
from pathlib import Path
import sys,unittest
ROOT=Path(__file__).resolve().parents[1]
for directory in ['pr54-release-runner-20261016/tests','pr54-cloud-watchdog-20261016/tests','pr54-watchdog-final-local-20261016/tests']:
    sys.path.insert(0,str(ROOT/directory))
import test_runner,test_cloud,test_clock_serialization
suite=unittest.TestSuite()
for module in [test_runner,test_cloud,test_clock_serialization]:
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
r=unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if r.wasSuccessful() else 1)
