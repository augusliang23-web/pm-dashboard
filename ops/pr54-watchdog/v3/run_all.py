#!/usr/bin/env python3
"""Run the imported (byte-identical) 37-test suite, then the v3 suite. Local only; no network, no cloud."""
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
IMPORTED = HERE.parent/'imported'
steps = [
    ('imported: runner 18 + cloud 18 + clock regression 1',
     [sys.executable, '-B', str(IMPORTED/'pr54-watchdog-final-local-20261016'/'run_combined.py')], IMPORTED),
    ('v3: acceptance, adapter, coordinator, recovery simulation, workflow static',
     [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'tests'], HERE),
]
for label, cmd, cwd in steps:
    print('==', label, flush=True)
    if subprocess.run(cmd, cwd=cwd).returncode:
        sys.exit(1)
print('ALL PASS')
