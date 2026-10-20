# Cloud execution contract v2 — frozen architecture, blocked execution

Status: **DESIGN_COMPLETE_WITH_EXPLICIT_BLOCKED_BINDINGS; NOT DEPLOYABLE**. This is an API/ownership contract, not a claim that Python runs inside Workflows. Existing runner remains the controller/state-machine simulation; the cloud prototype remains a protocol implementation. The live Workflows translation and thin provider adapter cannot be accepted while the required Functions administration scope is unresolved.

## Exact identities and execution split

Project `pm-dashboard-uat-20260820-a7f3`, number317352278230, regionus-central1. Proposed workflow: `projects/pm-dashboard-uat-20260820-a7f3/locations/us-central1/workflows/pr54-uat-recovery-watchdog`.

- Workflows identity: `pmdash-pr54-watchdog@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com`. Own coordinator state, validate grants and receipts, poll real operations, and orchestrate restoration via supported Google APIs.
- Remote runner identity: `pmdash-pr54-release@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com`. Existing Cloud Build default pool, no new trigger/pool. In the first control-plane-only drill it can read pinned artifacts/state and append events, not modify UAT serving resources.
- Receipt writer: must be a named separately approved normal-login operator on an independent device, or a separately reviewed cloud test identity. No principal is invented. No credential extraction, cookie export, Firebase custom-token bypass, service-account substitution for PM login or password in build substitutions/logs.
- Existing runtime identities stay `pmdash-save-project` and `pmdash-project-attn`; existing source-build identity is317352278230-compute. Existing Functions service agent performs managed source build/deploy internally. Workflows does not itself compile Node source, supply a Firebase PM session or prove user authorization.

All proposed roles and binding targets are enumerated in UAT_CLOUD_DRILL_AUTHORIZATION_MANIFEST.json. None were applied. Function update bindings are explicitly absent from the grantable set, not disguised as supported per-function IAM.

## State and durable ownership

Proposed dedicated bucket `pm-dashboard-uat-20260820-a7f3-pr54-recovery`, regional Standard, uniform bucket access and enforced public access prevention. Global name availability not checked; collision => STOP rather than silently choose another bucket. No locked retention on mutable coordinator. No object listing permission is needed: all event/receipt object names derive from known release/action IDs and bounded indices.

`coord/active.json` is the single project-wide coordinator. Only watchdog can read/replace it using generation-precondition writes. `manifests/<release-id>.json` and pinned source bundles are immutable; worker may read but never replace them. Worker can only append `events/<release-id>/<action-id>/<attempt>.json` with generation0. Separately trusted writer appends `receipts/<release-id>/<receipt-id>.json`, also generation0. Existing Functions-managed source bucket is read-only source provenance, never coordination storage.

Required coordinator fields: schema version, project ID/number, source SHA, release ID, workflow execution owner, nonce, approved manifest/baseline hashes, server-origin start, absolute30/45/60-minute deadlines, phase, active action/operation, ordered completion ledger, receipt generation and hash, incident/escalation evidence. Reject missing or changed bindings; never infer acceptance from absent fields.

Activation must use create-if-absent/CAS. A duplicate execution with a different owner cannot adopt the active release. Same owner may resume only identical bindings without resetting deadlines. Next-release activation requires terminal-state archival, verified absence of outstanding operations, immutable previous-generation evidence and CAS against the exact terminal generation. An old execution cannot overwrite the next owner's state. These owner/hash/rollover requirements exceed the earlier Python prototype; they require implementation and dedicated tests before live execution.

Workflows is the sole event consumer/state writer. No parallel branch writes the coordinator. Worker can request but never grant operations. Grant: stable action ID, explicit direction/step, bound baseline fingerprint and one active operation. At most one serving mutation can be submitted at a time. Do not use an expiring lease to steal an unconfirmed action.

## Google API contracts

Use OAuth2 for Google APIs with the attached dedicated identity, not stored keys. All endpoints/project IDs/resource names pass an allowlist before request construction. New artifacts and images must be pinned by SHA256 and GCS generation/container digest, respectively; those cloud identifiers are not available yet. Unpinned builder or mutable branch reference => STOP.

| Operation | Exact request and completion condition |
|---|---|
| Launch remote runner | POST `https://cloudbuild.googleapis.com/v1/projects/pm-dashboard-uat-20260820-a7f3/locations/us-central1/builds`; body explicitly sets approved serviceAccount, digest-pinned steps, generation-pinned source, `timeout:"3600s"`, and logging policy. No automatic GitHub trigger. Provider returns build/LRO identifiers; persist them before further work. The Python runner currently rejects live execution; this needs its thin provider adapter, not removing the safeguard blindly. |
| Poll remote build | GET same project's `locations/us-central1/builds/<id>`; optional cancel requires separate reviewed builds.update, not included in minimal role. Cancel never proves Functions LRO stopped. |
| GCS metadata/body | GET Storage JSON API object metadata then media at that exact generation. Replace via upload POST with ifGenerationMatch=currentGeneration; create immutable object with ifGenerationMatch=0.403 is permission denied, never absent.412 requires reread/revalidate, never unconditional overwrite. |
| Restore Hosting | POST `https://firebasehosting.googleapis.com/v1beta1/sites/pm-dashboard-uat-20260820-a7f3/releases?versionName=sites/pm-dashboard-uat-20260820-a7f3/versions/<approved-baseline>`; body release typeDEPLOY and sanitized release/action message. GET/list latest releases verifies actual target version. A lost POST response may create duplicate release records if retried: reconcile actual serving version/message first. Never treat it as exactly-once API. |
| Restore Rules | PATCH `https://firebaserules.googleapis.com/v1/projects/pm-dashboard-uat-20260820-a7f3/releases/cloud.firestore`; body **wrapped** as `{release:{name:<exact-release>,rulesetName:<approved-ruleset>},updateMask:"rulesetName"}`. GET release verifies exact pointer; do not delete/create rulesets for rollback. This is Rules configuration, not a Firestore business write. |
| Restore Save | PATCH `https://cloudfunctions.googleapis.com/v2/projects/pm-dashboard-uat-20260820-a7f3/locations/us-central1/functions/saveDashboardProject?updateMask=buildConfig.source`; body name plus generation-pinned approved original source. Poll returned Functions operation asynchronously, then verify function source/config and actual Run serving revision. Runtime nodejs22, existing SA/memory/maxInstances and unrelated fields remain baseline. |
| Restore Attention | Same endpoint suffixsetDashboardProjectAttention; source-only mask, runtime nodejs20, maxInstanceCount20, existing runtime/build identities and unrelated settings. Exact same-configuration drift must be rejected; source-only update does not magically restore unrelated configuration drift. |
| Invocation configuration | Read exact Run services savedashboardproject/setdashboardprojectattention and policy fingerprints; no setIamPolicy. If approved restoration requires it, PATCH only reviewed invokerIamDisabled field=true with etag and bounded LRO polling. Re-read after Functions build because managed deployment can affect backing Run config. Never use allow-unauthenticated or org-policy relaxation. |
| Existing Draft functions | Limited recovery drill does not create/delete them. Existing runner remove_new_drafts step maps to verified NOOP if release-created resource list is empty. Inventory drift => STOP. A future PR54 deployment needs a separate exact four-resource creation/deletion approval. |

Source-only function rebuilds are asynchronous managed operations, not instantaneous revision switches. Workflows can submit/poll them only with sufficient supported IAM. It cannot guarantee completion during a provider outage. No existing Cloud Build triggers were returned in the prior snapshot; reuse means the enabled build service/default pool, not claiming an approved trigger already exists.

## Operation reconciliation, retries and deadlines

Persist grant before submission, then append/persist returned operation ID and verify its project/region/API. Worker status alone is untrusted. Only provider DONE plus expected source/config/serving readback completes an action. RUNNING/unknown fences every new serving operation. If response is lost before operation ID is persisted, query authoritative operations/build inventory and match exact resource, start window and deployment fingerprint. No unique matching result => RECOVERY_HOLD and alert; never assume NOT_STARTED from a missing local receipt. Functions patch has no asserted exactly-once request ID in this contract.

Use asynchronous REST and10-second bounded polls, short HTTP timeouts and limited exponential backoff. A single retry/wait may never bypass the absolute deadline check. Workflows default connector LRO wait is30 minutes; do not put that blocking wait in the watchdog loop. The build queues/polls must not reset the persisted maintenance start.

Missing verified acceptance at30m or critical failure requests rollback. No forward actions after45m. Incomplete recovery at60m records an incident and alerts independently; no implicit window extension. In-flight operation reconciliation can prevent immediate rollback to avoid competing deployments. A stuck API operation is a genuine residual risk, not solved by shortening a local timeout.

The authoritative operation slot covers real mutation submission, not only build lifecycle. No local adapter can start its next action without current cloud grant. Do not replay an old grant after a different owner/action or after forward fencing. The live worker must reconfirm grant immediately before submission; if a granted request might already have been submitted, only authoritative reconciliation can release its slot.

## Authenticated success and escalation

Disarm only before deadline with no active mutation, exact release/source/manifest/baseline/nonce-bound receipt, explicit Admin and PM normal-login checks, completed test times after arming, and independent fresh cloud readback. Include Firebase Auth, PM ownership, Save/Publish, released protection, Archive preservation and Overview/PDF parity for future PR54 acceptance. For legacy recovery, receipt specifically proves real authenticated PM save and Attention, plus unauthorized/forged-token rejection. Never mark legacy restore success using PR54-only Draft endpoints that are not deployed.

A separate receipt prefix prevents a worker from self-attesting. IAM alone does not prove truth of receipt contents; the trusted human/harness must record actual test case/evidence IDs and sign off. Its identity and normal-login readiness are unresolved, so the current request cannot disarm a live watchdog. Missing attester after Mac shutdown allows cloud configuration restoration but ends RESTORED_AWAITING_AUTH/HOLD, not PASS.

Emit sanitized structured logs keyed by release/action/operation, no payload/session/token/raw error dumps. A separately authorized log-based alert routed through an existing approved notification channel monitors incomplete releases, hard deadline, workflow failure/cancellation and permission denial. Channel selection/alert policy are currently unresolved; logs alone are not escalation delivery. Workflows failure itself must be monitored externally. Proposed cloud architecture remains unchanged; no extra custom daemon is added.

## Exact blocking IAM evidence

Google's current Functions v2 IAM guide states only execution permissions are allowed at per-function level. Its resource-name condition support is not established by the generic IAM resource table. Therefore do **not** generate a fake function-only update grant or assume a resource.name condition works. A custom project role with functions.update/sourceCodeSet still reaches other UAT Functions and requires a new explicit scope decision. A script allowlist is defense in depth, not an IAM boundary.

Also do not combine cloudbuild.builds.create and actAs on the existing compute/data runtime identity without reviewing escalation: it can permit starting arbitrary build code as that identity. Existing service-agent rights are not automatically transferable to the watchdog. Read-only PDF preservation does not justify giving it PDF deployment rights. No Owner/Editor/Firebase Admin/Functions Admin/Run Admin/Storage Admin/Token Creator grant is proposed.

The exact cloud execution contract is consequently specified but not executable/authorizable end to end. Resolving that security boundary must return to the Control Plane; no architecture or deployment method is silently substituted.

## Primary evidence

- [Functions IAM: per-function execution-only restriction](https://docs.cloud.google.com/functions/docs/concepts/iam)
- [Functions source update and field mask](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch)
- [Hosting release API](https://firebase.google.com/docs/reference/hosting/rest/v1beta1/sites.releases/create)
- [Rules patch request wrapper](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/patch)
- [Workflows connector waits](https://docs.cloud.google.com/workflows/docs/connectors)
- [Cloud Build create connector](https://docs.cloud.google.com/workflows/docs/reference/googleapis/cloudbuild/v1/projects.locations.builds/create)
- [IAM resource attribute support](https://docs.cloud.google.com/iam/docs/conditions-resource-attributes)
