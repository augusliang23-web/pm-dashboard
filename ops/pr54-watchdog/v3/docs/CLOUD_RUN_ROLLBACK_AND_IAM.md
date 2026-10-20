# Cloud Run rollback feasibility and IAM permission matrix

Evidence labels: **DOC** = stated in Google documentation fetched in this work; **MODEL** = assumed, to be confirmed at G2; **GAP** = could not be established.

## 1. Why the previous design was held

Cloud Functions v2 lets IAM be set per function only for *execution* permissions (DOC: "Currently, only execution permissions are allowed at the per-function level."). A function-scoped update/`sourceCodeSet` grant therefore cannot exist; the only update grant is project-wide, which reaches every function. v3 avoids that class of permission entirely.

## 2. Feasibility of Cloud Run traffic rollback

| Question | Finding |
|---|---|
| Can roles be granted on one Cloud Run service? | DOC: yes, "per-service, per-job ... basis". |
| Is a traffic pin to a named revision a supported rollback? | DOC: `gcloud run services update-traffic --to-revisions REVISION=100`; REST equivalent is PATCH of `traffic` on the service (MODEL for exact field names). |
| Does it re-run health checks? | DOC: no. Functional proof must come from authenticated tests. |
| Does the pin survive later deployments? | DOC: traffic patterns persist for later deployments. Needs a post-drill step (manifest `postDrillObligations`). |
| Permission to update a service | DOC: `run.services.update` (plus `run.services.get`, `run.operations.get` to read status). It is a general update permission, **broader than traffic-only** (GAP: no traffic-only permission found). |
| `iam.serviceAccounts.actAs` | DOC: Google's rollback guidance lists *Service Account User on the service identity* as a required role; the permission reference lists actAs among deploy requirements. Whether a `updateMask=traffic` request needs it is GAP -> G2 `validateOnly` test. Bounded by granting it resource-level on the two runtime SAs only. |
| `validateOnly` as preflight | DOC: validates the request and fills defaults without saving. Whether it also evaluates every IAM check is GAP; it is used as necessary, never sufficient, evidence. |
| `etag` on Service | MODEL: used as optimistic concurrency and as a submission fingerprint; real field behaviour is GAP -> G2. `etag_semantics_validated` stays false until then, which makes ambiguous submissions fail closed. |
| Functions v2 compatibility | MODEL: the two functions are backed by Cloud Run services with matching names. After a Cloud Run rollback the Functions resource may still describe the candidate source; later Functions deploys must reset traffic deliberately. |
| Invocation check preserved | the adapter never writes `invokerIamDisabled`, `ingress` or IAM; drift in them blocks rollback (tested) because a traffic pin would not restore them. Changing `invokerIamDisabled` would need `run.services.setIamPolicy` (DOC), which is never granted. |
| Service identity, runtime and environment preserved | restored by the immutable baseline revision template; the adapter checks the revision fingerprint (identity, image, env, scaling, concurrency, timeout) before pinning. |
| Revision drift | baseline revision missing, not Ready or fingerprint changed => `Drift` => hold, no mutation (tested). |
| Post-rollback functional verification | authenticated legacy receipt required before `ROLLED_BACK` (tested). |

Conclusion: feasible in the model and in local tests; **not proven against real Google Cloud**.

## 3. Identity

One runtime identity: `pmdash-pr54-watchdog@pm-dashboard-uat-20260820-a7f3.iam.gserviceaccount.com`, no keys. A separate named human/test identity writes receipts. A setup operator (human) creates everything and later removes the grants.

## 4. Permission matrix (watchdog identity)

| Capability | Permission(s) | Scope | Label | Why |
|---|---|---|---|---|
| Read/write coordinator | `storage.objects.get/create/delete` | bucket, `objects/coord/` condition | DOC (delete required to overwrite) | CAS writes |
| Read manifests, receipts | `storage.objects.get` | bucket, `manifests/`, `receipts/` conditions | DOC | pinned inputs; cannot write them |
| Pin Cloud Run traffic | `run.services.get`, `run.services.getIamPolicy`, `run.services.update`, `run.revisions.get` | the two services only | DOC for service-level; revisions scope MODEL | rollback + drift readback |
| Poll operations | `run.operations.get` | service-level if accepted, else project (fallback) | GAP | LRO status; exposes status only |
| Act as runtime SAs | `iam.serviceAccounts.actAs` via `roles/iam.serviceAccountUser` | resource-level on `pmdash-save-project`, `pmdash-project-attn` | DOC (required for deploys/rollback guidance); necessity GAP | only if G2 shows it is needed |
| Restore Hosting | `firebasehosting.sites.get/update` | project (no per-site binding) | DOC (sites.*), exact release permission GAP | restore finalized baseline version |
| Restore Rules | `firebaserules.releases.get/update`, `firebaserules.rulesets.get` | project | MODEL | restore baseline ruleset pointer |
| API use / logs | `serviceusage.services.use`, `resourcemanager.projects.get`, `roles/logging.logWriter` | project | DOC | quota attribution, sanitized logs |

**Never granted:** Owner/Editor, Run Admin, project-wide Run Developer, `run.services.setIamPolicy`, any Cloud Functions update/`sourceCodeSet`/Admin, Cloud Build roles, Artifact Registry reader, `actAs` on compute/source-build/Firebase Admin/PDF identities, Token Creator, Firestore data roles, Storage Admin, Firebase/Auth admin, workflow edit rights, any Production or PDF binding.

## 5. Minimum unavoidable privilege and compensating controls

1. **`run.services.update` on two services.** Exceeds traffic-only. Controls: two services only; workflow immutable to its own identity and static-tested to emit only `updateMask=traffic`; Artifact Registry read deliberately withheld so an image-changing update should be rejected (relied on only after the G2 negative `validateOnly` test); Admin Activity audit alerts on any `UpdateService` outside an armed release; grants removed after the drill window.
2. **Project-wide Hosting and Rules restore rights.** No finer scope exists (Hosting sites and Rules releases are not individually bindable). Controls: UAT project only; targets are manifest-pinned immutable versions; G1 refuses if the project has more than one Hosting site; audit alerts outside armed releases.
3. **Receipt truthfulness** is a human-process control that IAM cannot enforce.

## 6. Does the boundary hold?

The two project-wide pointer-restore rights (Hosting, Rules) are the weakest part: they can repoint UAT's served site and Firestore rules at any existing version/ruleset. They are justified only because the project is UAT-only, the workflow limits itself to manifest-pinned targets, and the grants are time-boxed and audited. The Control Plane should explicitly accept or reject that residual risk; it is stated, not hidden. If rejected, rollback of Hosting and Rules would stay manual.
