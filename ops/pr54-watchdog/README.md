# PR54 Cloud Watchdog (v3 development)

Local, review-only development of an unattended recovery watchdog for the PR54 UAT cutover. **Nothing here is deployed, enabled, provisioned or authorized.** CI only runs the repo's existing tests; this directory has no deploy hook, workflow trigger or script that touches the cloud.

```
ops/pr54-watchdog/
  imported/   byte-identical copies of the earlier Codex work (see below)
  v3/         new work: coordinator, Cloud Run adapter, acceptance contract, simulation, Workflows draft, docs, manifest
```

## Imported artifacts

11 files copied unmodified from `~/.codex/.chatgpt-projects/.../outputs/pr54-*-20261016/` (originals untouched). Hashes of `runner.py`, `test_runner.py`, `cloud_bridge.py`, `test_cloud.py` match `imported/pr54-watchdog-final-local-20261016/SOURCE_IDENTITIES.json`. The timing-race fix (`runner-clock-fix.patch`) is already contained in the imported `runner.py`; it must not be applied again.

## v3 additions

| File | Purpose |
|---|---|
| `v3/coordinator_v3.py` | extends the reviewed coordinator: execution-owner and manifest/baseline hash binding, safe rollover, pre-submission etag, operator hold, fail-closed step verifiers, legacy-receipt gate |
| `v3/cloud_run_rollback.py` | Cloud Run traffic-pin adapter (injected transport, no default executor, no credentials) |
| `v3/acceptance.py` | authenticated acceptance validator |
| `v3/recovery_sim.py` | in-memory model of the provider plus a driver mirroring the workflow loop |
| `v3/workflows/pr54-recovery-watchdog.yaml` | Cloud Workflows draft, never compiled |
| `v3/docs/*` | execution contract, Cloud Run feasibility and IAM matrix, acceptance contract |
| `v3/UAT_CLOUD_DRILL_AUTHORIZATION_MANIFEST_V3.json` | UAT drill authorization manifest (`executable: false`) |

## Run the tests (local, no network)

```bash
python3 -B ops/pr54-watchdog/v3/run_all.py
```

Runs the imported 37-test suite, then the 84 v3 tests (acceptance 12, adapter 22, coordinator 20, recovery simulation 18, workflow static 12).

## Honest limits

- Cloud behaviour is modelled, not observed. The simulation proves protocol logic, not Google Cloud.
- The Workflows YAML parses as YAML and passes static safety checks, but it has never been through the Workflows compiler.
- The authorization manifest still has named-human inputs unfilled; it is not signable.
