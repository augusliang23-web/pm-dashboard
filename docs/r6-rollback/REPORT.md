# PR76 R6 rollback UI hotfix

## Contract and source identity

Owner task PR76_R6_ROLLBACK_UI_HOTFIX. Dedicated branch `codex/pr76-r6-assignment-error` starts at exact PR76 `ce01cb0a4dac7d5de7b8b1a472b50ee9ac5a18ab` and targets `codex/hotfix-admin-pm-self-assignment`. Corrected candidate is the commit containing this report; the final exact HEAD and CI run are pinned in the Draft PR body. Tested frontend file SHA256 values are in evidence/tested-source.json, so documentation commits cannot be mistaken for untested runtime changes.

PR76 and PR77 (`e40f6e46b8b66bc51e20d3397654d7e018c0ec80`) were not modified. No backend, capability protocol, delegation, IAM, Rules, Auth configuration, PDF, Cloud Run or live business-data changes. No merge/deployment. Browser profiles named Production/UAT are local synthetic builds, not deployed environments.

## Root cause and minimal fix

The authentic old backend emits permission-denied with structured `details.reason=assignment-forbidden` for a new Admin-self assignment. Both the controller and page treated every permission-denied as loss of access. The page invalidated the editing session, closed the modal and cleared unsaved name/code before the save catch could render its inline error.

`js/project-drafts-controller.mjs` now exports one shared access-loss classifier and includes/reset `errorReason` in state. Only the exact assignment-forbidden reason with a supported permission-denied code is recoverable. Unauthenticated always wins, including a misleading assignment reason. Missing/malformed/unknown details, role-forbidden, draft-forbidden and ownership-forbidden still clear protected state. `index.html` uses that same classifier. The original callable rejection propagates; existing save catch renders the real inline error, retains every field/selection and re-enables controls. No success is reported and no backend authorization changes.

`js/project-drafts-api.mjs` was inspected: SDK errors already retain structured details, so it requires no change.

The historical source fixture adds exactly the two reviewed import/guard substitutions. No frozen SHA was replaced and no broad normalization bypass was added.

## RED / GREEN evidence

- RED before product changes: new behavior tests failed for both permission-denied spellings; ten security-negative cases passed (evidence/unit-red.txt).
- Fresh real-browser RED: original PR76 Hosting + actual old backend closed the editor, yielding empty name/code; expected R6-UNSAVED assertion failed (evidence/red-browser.json and red.png).
- GREEN: **20/20 real Functions-emulator/Chromium groups**, zero page errors, both Production/UAT profiles. Full route/error trace and owner proof: evidence/green-browser.json; readable result: evidence/browser-green.txt.
- Affected node tests: **77/77 PASS**. Command: `node --test tests/project-draft*.test.mjs tests/admin-self-source-baseline.test.mjs tests/auth-session*.test.mjs tests/role-contract.test.mjs tests/delivery-trends-integration.test.mjs`.
- Both Hosting builds pass. Built index/controller hashes match the tested source hashes.
- One fresh bounded source/security review found no blocking P1/P2 findings. It verified the shared classifier, fail-closed cases, exact fixture normalization and PR77 overlap; this is source-review evidence, not independent product acceptance or Gate approval.

The R6 browser cases exercise both Save Draft and Save & Publish: all form input/select/textarea values remain byte-equivalent, attempted Admin choice remains selected, modal stays open, inline error is visible, success toast stays hidden, and the complete draft/week snapshots remain unchanged. Selecting a legitimate PM and retrying then succeeds without losing typed values.

## Authentic mixed runtime provenance

Each old/new source uses a separate emulator codebase. No single candidate bundle substitutes for other deployed handlers. Only local entry adapters initialize demo persistence, use the UAT policy environment and alias the authentic exported handler; all other runtime bytes are verified unchanged in evidence/runtime-integrity.json. Node22.23.3 and locked runtime dependencies, Java21, Firestore emulator1.22.0 and actual Chromium were used.

| Logical callable | Actual fixed source generation | Local routing |
|---|---|---|
| Old Save Draft |1792246605343539|oldSave|
| Old Publish |1792246708585409|oldPublish|
| Existing Get |1792472787289328|getDashboardProjectDraft|
| Existing List |1792246434915775|listDashboardProjectDrafts|
| Existing legacy Save/Archive |1792472904180830|saveDashboardProject|
| Candidate Save/Publish |PR76 exact base; unchanged by this frontend fix|newSave/newPublish|

Old Save/Publish/List ZIP SHA256 is `9086cabb90e7f9466f2298670bdfce12ddb0e804c5078764a472bac3105252d9`; other complete hashes are in evidence/provenance.json. Actual old Hosting release1792473025892000/version638b61132880b294 (a17f56c) was downloaded read-only; its39 application file hashes are in evidence/hosting-provenance.json.

All persistence/auth use `demo-pm-dashboard-v22t` on127.0.0.1:8188/9198. Seven codebases run at5118; local routing5108 selects real old/new callables; local static Hosting4198 serves profiles. Workers assert emulator endpoints and initialize Admin SDK demo storage explicitly. Policy environment identifiers select the real UAT branch; they do not select live persistence. Browser emulator mode also selects demo, blocks external dynamic requests, and allows only static SDK/fonts externally. `releaseCapabilities/v231` remains absent throughout. Passwords are random in memory and absent from evidence.

## R1–R7 and security negatives

- R1: actual old Hosting shows empty Admin owner option; no unsafe save submitted; stored snapshot unchanged. This is a passing detection of a forbidden combination, not approval to use old Hosting.
- R2: both Admins' progress-only saves against old backend preserve the existing Admin owner, in both profiles.
- R3: old Publish with corrected UI preserves official owner, name and progress.
- R4: unsupported new assignment still denied without writes; PM API save/get/list/publish remain valid.
- R5: PM browser save/publish works against old backend in both profiles.
- R6: Save/Publish rejection keeps all fields and selection, renders inline error and supports a legitimate-PM retry in both profiles.
- R7: original Admin-owned draft and official project remain intact at83% with unchanged name/owner.

Real backend negative tests in both profiles: strip the outgoing test token to obtain unauthenticated; change only the synthetic role to VIP to obtain role-forbidden; revoke a separate synthetic PM draft's editor membership to obtain draft-forbidden. Each closes/scrubs the protected editor and leaves draft/week snapshots unchanged after the denial. These are actual old-handler responses, not fabricated backend errors. Controller/page behavioral tests additionally cover raw/namespaced status codes, misleading reason on unauthenticated, ownership revocation, missing/empty/malformed/unknown details, and retry with absent details after a recoverable failure.

## Rollback matrix

| Frontend/backend combination | Allowed use |
|---|---|
| Actual old Hosting + old writes | PM-only baseline works; **forbidden for editing existing Admin-self-owned records**. No verified freeze exists. |
| Actual old Hosting + PR76 writes | PM-only transition baseline was previously verified; **do not allow edits of Admin-self-owned records** with that UI. |
| Original PR76 Hosting + old writes | Existing-owner edits can work, but R6 input loss makes this an unsuitable general rollback frontend. |
| Corrected frontend + old writes + unchanged Get/List/legacy | **Locally verified compatible rollback**: existing Admin owners and PM workflows safe; new unsupported Admin assignments rejected with retained form/error. |
| Corrected frontend + PR76 writes + unchanged Get/List/legacy | Intended corrected UAT candidate. Original mixed-version normal workflow evidence is retained; this patch only changes rejection handling. Live UAT acceptance still required. |

During a rollback keep the corrected Hosting version serving; restore only the two pinned old write-handler sources/configurations if separately authorized. Never roll Hosting back to version638b61132880b294 and then permit Admin-owner editing. Do not delete/reassign persisted Admin data. Account for already-open/cached old tabs; this patch does not add a client-version enforcement/freeze mechanism. Downloadable sources and local simulation are not an executed cloud restoration or timing guarantee.

When old backend remains live, unsupported new Admin choices cannot be proactively disabled using existing capabilities. No new flag/protocol was invented. The compatible strategy is to retain this corrected frontend, show the actual rejection without losing input, and let the user change to a supported PM or cancel. Authentication/access loss still closes the editor.

## PR77 overlap and later integration

PR77 already carries errorReason and a page-level assignment exception, alongside lane concurrency/delegation changes. None of those broader changes was imported. Later, only after separate authorization, reconcile this hotfix into PR76 and resolve PR77's controller/page overlap once: retain its lane logic but use this shared classifier, keep one errorReason field/reset, remove the superseded broader exception and avoid duplicate imports/fixture hunks. Re-run affected error/authorization tests. Do not cherry-pick the whole PR77 commit, rebase/retarget it, or double-apply this correction now.

## Reproduction

The prepared authentic-artifact lab is retained at `/private/tmp/pr76-mixed-version-20261023`; its prepare.py/setup.py/provenance.json record preparation. It contains the pinned ZIPs and isolated workers. On this machine:

1. Put Node22 and Java21 on PATH. From that lab, start `firebase emulators:start --only auth,firestore,functions --project demo-pm-dashboard-v22t --config firebase.json`.
2. Build corrected frontend profiles into lab `new-site` (UAT) and `prod-site` (Production) using repository buildHosting/loadHostingEnv; `old-site` must remain the authentic old Hosting bytes. The existing build-r6-sites.mjs records the exact preparation used; on a repeat preserve/rename the base site only once.
3. Run the repository script with `R6_LAB_ROOT` pointing at that lab, `R6_BROWSER_PACKAGE` pointing at a package.json whose node_modules has Puppeteer, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8188` and `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9198`: `node scripts/verification/r6-rollback-e2e.mjs`.
4. Expected:20 PASS/0 FAIL. It resets ONLY the pinned demo emulator fixtures; never share this instance with other work. Stop emulators afterward.

A fresh machine needs read-only access to the five pinned UAT source ZIP generations, or the preserved ZIPs, before this integration test can run. Missing authentic artifacts means BLOCKED, not permission to replace old handlers with mocks. JSON route/evidence files and screenshots are synthetic; no credentials are included.

## Recommendation / boundary

Local implementation and bounded regression evidence support **GO for Control Plane review**, conditional on final exact-SHA CI. This is not PR acceptance, merge permission, a cloud release Gate, deployment authorization or live UAT acceptance. The PR remains Draft.

Future UAT release scope, only after separate explicit authorization, is the integrated reviewed frontend plus saveDashboardProjectDraft and publishDashboardProjectDraft in UAT us-central1. This hotfix itself requires only Hosting once its backend compatibility choice is approved. No other Functions, Rules, IAM, Auth, PDF, direct Cloud Run or Production changes are authorized.
