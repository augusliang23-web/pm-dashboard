# PM Dashboard — Architecture Baseline & Security Invariants

**Document Version**: Phase F1 Baseline — Final Remediation (2026-10-17)  
**Canonical Baseline SHA (`main`)**: `4a8e7ee63cdf40c3699c834b5ff18c7427e307b0` (PR #49)  
**Production Pages Baseline SHA (`production-pages`)**: `9c4254142cdd59f28854ec78cf095681e916324f` (PR #48)

> **Scope & Maintenance Boundary**:
> - **Part I (Sections 1–11)** documents **Stable Architecture Facts & Security Invariants** of PM Dashboard as implemented on `main` (`4a8e7ee`). It does not claim that proposed future modularization or test-refactoring steps have been implemented.
> - **Part II (Appendix A)** is a **Dated Operational Snapshot (as of 2026-10-16)** of active parallel development branches, PR stacks, and conflict matrices.
> - **No Routine Commit Overhead**: Routine local commits, feature-branch iterations, and local worktree testing do **not** require updating this document. Part I is updated only when a merged PR alters an architectural boundary or security invariant; Appendix A is refreshed only at formal integration gates or pre-release audits.

---

# Part I — Stable Architecture Facts & Governance Invariants

## 1. System Architecture & Governance Roles

### 1.1 Four Runtime Pillars
PM Dashboard is a multi-environment portfolio, weekly status, Executive milestone governance, and professional PDF reporting system built on four runtime pillars:

1. **Browser Single-Page Application (`index.html` + `js/*.mjs`)**:
   - Served as a zero-bundler native ES module closure.
   - A single `index.html` (~13,669 lines on `main`) embeds shared styles, modal/page markup, and the main application controller, importing 22 modular ES files from `./js/*.mjs` plus root shared helpers (`sync-core.js`, `executive-timeline-core.js`, `professional-pdf-client.mjs`, `week-carryover.mjs`).
2. **Firebase Cloud Functions (`functions/`)**:
   - Node.js 22 (CommonJS, Firebase Functions Gen 2) backend providing authenticated `onCall` mutation endpoints for business data, user permission overrides, Executive milestone workflows, daily presence rollup scheduling (`aggregatePresenceSessions`), and the read-only Production-to-UAT week sync boundary.
3. **Firestore Security Rules (`firestore*.rules`)**:
   - Enforces fail-closed role, capability-override, and schema-envelope access controls at the database layer. Direct client writes to `weeks`, `users`, `userPermissions`, `userPermissionAudit`, `presenceDailyRollups`, Executive milestone collections, and sync operational collections are denied; direct client writes are permitted only on schema-validated telemetry collections (`logs`, `presence`, `presenceSessions`) and, in UAT/shared-backend rules only, Admin-only Gantt template writes to `dashboardSettings/team-2-portfolio`.
4. **Cloud Run PDF Service (`pdf-service/`)**:
   - Node.js 24 + headless Chromium service deployed to Google Cloud Run (`asia-southeast1`). Authenticates Firebase Bearer ID tokens, verifies user roles from Firestore (`users/{email}`), loads authorized week/project data, normalizes report models, and renders paginated PDF reports via DOM measurement (`measured-paginator.js`).

### 1.2 Architecture & Release Governance Roles
To maintain clear accountability across parallel development tracks without slowing down day-to-day coding, responsibilities are separated across four roles:

| Governance Role | Core Responsibilities | Authority Boundary |
|---|---|---|
| **Control Plane** | Defines architectural direction, cross-track integration sequencing, conflict disposition, release gate criteria, and final `PASS` / `HOLD` decisions. | Does not directly mutate branches or run deployment commands. |
| **Development Engineer** | Implements features, bug fixes, or documentation in isolated branch worktrees; runs local unit tests and non-destructive conflict simulations (`git merge-tree`); prepares release provenance checklists. | Must not modify other tracks' branches/worktrees or execute live cloud deployments (Class C commands) without explicit Release Approver sign-off. |
| **Independent Reviewer** | Performs independent technical verification of PRs, architectural invariants, security rules, and provenance evidence against actual repository source and test suites. | Issues objective findings (`P0`–`P3`) and review status (`PASS` / `HOLD`); does not self-approve own implementation work. |
| **Release Approver** | Human operator (together with Control Plane gate sign-off) who authorizes executing Class C deployment or traffic-routing commands against shared UAT or Production environments. | Verifies completed `docs/RELEASE_PROVENANCE_CHECKLIST.md` (including `CROSS_TRACK_FEATURE_PRESERVATION`) before approving any shared-environment deployment. |

---

## 2. `main` vs `production-pages` Responsibilities

The repository maintains two distinct long-lived release branches serving different hosting surfaces:

| Branch | Baseline SHA (`main` / `production-pages`) | Primary Responsibilities | Update & Promotion Policy |
|---|---|---|---|
| **`main`** | `4a8e7ee63cdf40c3699c834b5ff18c7427e307b0` | Canonical source of truth for:<br/>1. **UAT Firebase Hosting** (`--env uat`)<br/>2. **Production Firebase Hosting** (`--env prod`)<br/>3. **Firebase Cloud Functions** (`functions/`)<br/>4. **Firestore Rules & Indexes** (`firestore*.rules`)<br/>5. **Cloud Run PDF Service** (`pdf-service/`)<br/>6. **Release & Sync Governance Manifests** (`config/*.json`) | Changes merge via reviewed PRs passing all 5 required GitHub Actions CI checks (`root-tests`, `firestore-rules`, `pdf-tests`, `sync-boundary`, `hosting-builds`). |
| **`production-pages`** | `9c4254142cdd59f28854ec78cf095681e916324f` | Dedicated static publishing branch for **GitHub Pages** (`https://augusliang23-web.github.io`). Uses the committed default `env-config.js` (`dashboardProfile: "production"`). | **Never merged directly before backend readiness.** Production-approved frontend changes on `main` are explicitly ported to `production-pages` via a dedicated PR (e.g., PR #40, PR #48) **only after** Production Functions, Rules, Firebase Hosting, and authenticated smoke checks have passed (enforced by `config/deployment-manifest.json` `productionPages.mergeOnlyAfter`). |

---

## 3. UAT and Production Deployment Surfaces

Environment targets are configured in `scripts/hosting-env.mjs`, `.firebaserc`, `env/*.json`, and `pdf-service/src/targets/registry.json`.

| Surface | UAT Target (`uat`) | Production Target (`prod` / `production`) | Authoritative Config / Guardrail |
|---|---|---|---|
| **GCP / Firebase Project** | `pm-dashboard-uat-20260820-a7f3` | `project-manager-dashboar-a067f` | `.firebaserc`, `scripts/hosting-env.mjs` |
| **Firebase Hosting** | `https://pm-dashboard-uat-20260820-a7f3.web.app` | `https://project-manager-dashboar-a067f.web.app` | `env/uat.json`, `env/prod.json`, `scripts/build-hosting.mjs` |
| **GitHub Pages** | N/A (Never points to UAT) | `https://augusliang23-web.github.io` (`origin/production-pages`) | Committed root `env-config.js` (`dashboardProfile: "production"`) |
| **Cloud Run PDF Service** | `pm-dashboard-uat-pdf` (`asia-southeast1`)<br/>`https://pm-dashboard-uat-pdf-b266ahac7q-as.a.run.app` | `pm-dashboard-pdf` (`asia-southeast1`)<br/>`https://pm-dashboard-pdf-a4naj265kq-as.a.run.app` | `pdf-service/src/targets/registry.json`, `pdf-service/scripts/deploy-pdf.mjs` |
| **Cloud Functions** | Deployed to `pm-dashboard-uat-20260820-a7f3` (includes UAT sync callables) | Deployed to `project-manager-dashboar-a067f` (18 functions, per-function SA `pmdash-*`) | `config/deployment-manifest.json`, `functions/index.js` |
| **Firestore Rules** | `firestore.uat.rules` (`firebase.uat.json`) | `firestore.rules` (`firebase.json`) | `npm run test:rules` (`prod`, `uat`, `shared-backend`) |

---

## 4. Frontend Module Boundaries, Build Checks & Dual-Profile Mechanism

### 4.1 Asset Closure, Config Validation & Build-Time Leak Check
Frontend build and environment binding are governed by four distinct mechanisms that must not be conflated:

1. **Static Asset Closure (`scripts/hosting-assets.mjs`)**:
   - Starts at `index.html` and transitively collects all local `<script src>`, `<link href>`, and static `import ... from './...'` references. Dynamic relative `fetch()`, `new URL()`, or `Worker()` calls are rejected at build time.
2. **Environment Config & Target Registry Validation (`scripts/hosting-env.mjs` $\rightarrow$ `loadHostingEnv()`)**:
   - Validates `env/uat.json` and `env/prod.json` before copying files:
     - Verifies `Object.hasOwn(HOSTING_TARGETS, name)` (`uat` or `prod`), required non-empty text fields (`environment`, `dashboardProfile`, `release`, `baseCommit`, `firebaseProjectId`, `hostingSite`, `hostingOrigin`), `pdfServiceUrl` URL/null syntax (`isRegisteredPdfServiceUrl`), and `env.environment === name`.
     - **Firebase Project ID Allowlist Check**: Asserts `env.firebaseProjectId === HOSTING_TARGETS[name]` (`'pm-dashboard-uat-20260820-a7f3'` for `uat`, `'project-manager-dashboar-a067f'` for `prod`).
     - **Hosting Origin Consistency Check**: Asserts `env.hostingOrigin === https://${env.hostingSite}.web.app` (checks that `hostingOrigin` matches the URL constructed from `env.hostingSite`; `hostingSite` itself is not checked against a separate allowlist).
     - **PDF Service URL Registry Check**: Reads `pdf-service/src/targets/registry.json` (`loadRegisteredPdfServiceUrl`, mapping `uat -> uat` and `prod -> production`) and asserts `env.pdfServiceUrl === registeredPdfServiceUrl`.
3. **Post-Copy Build Output Project-ID Scan (`scripts/build-hosting.mjs` $\rightarrow$ `assertNoCrossEnvironmentLeak()`)**:
   - After copying the asset closure to `dist/` and writing `dist/env-config.js`, `assertNoCrossEnvironmentLeak(outDir, files, env)` reads every generated file in `dist/` and checks **only** whether any file contains the opposite environment's **Firebase project ID string** (`'project-manager-dashboar-a067f'` when building `uat`, or `'pm-dashboard-uat-20260820-a7f3'` when building `prod`).
   - *Important Distinction*: `assertNoCrossEnvironmentLeak()` does **not** scan built files for arbitrary Hosting origins or arbitrary PDF URLs; origin and PDF URL checks occur earlier in `loadHostingEnv()`.
4. **Critical Architectural Fact — `@uat-only` Markers Are NOT Stripped by `scripts/build-hosting.mjs`**:
   - `scripts/build-hosting.mjs` copies `index.html` and all referenced `.js`/`.mjs` files verbatim into `dist/` and overwrites **only** `dist/env-config.js`.
   - The `@uat-only`, `@prod-only`, `@profile-group`, and `@profile-stmt` comment markers in `index.html` are **not** stripped in `dist/index.html`.
   - Instead:
     - **At runtime in the browser**, `index.html` reads `window.PM_DASHBOARD_ENV.dashboardProfile` (`"production"` vs `"uat"`), sets `IS_UAT_PROFILE`, and applies CSS/DOM visibility rules (`[data-profile-only="uat"]`) plus `if (IS_UAT_PROFILE)` guards.
     - **At test time**, `tests/helpers/dashboard-source.mjs` (`renderProfile()`) strips `@uat-only` / `@prod-only` blocks and resolves `@profile-group` variants to synthesize the effective Production code view (`dashboardSource('production')`) and UAT code view (`dashboardSource('uat')`).

### 4.2 Client-Side Gating vs Server-Enforced Authorization
- **Client-side runtime checks and UI hiding (`IS_UAT_PROFILE`, `data-profile-only="uat"`, role-based button visibility, `canWithPermissions`) are defense-in-depth UX controls only.** Because `dist/index.html` ships all frontend code to the browser and Firestore documents read by the client contain full document payloads, client checks never constitute a security or confidentiality boundary.
- **Actual authorization boundaries are enforced on the server** across Firestore Security Rules, Firebase Callable Functions, and the Cloud Run PDF Service (detailed in Section 6).

---

## 5. Firebase Functions Architecture (`functions/`)

- **Entrypoint**: `functions/index.js` exports 21 endpoints on `main` (`4a8e7ee`):
  - **1 Scheduled Function**: `aggregatePresenceSessions` (`us-central1`, daily UTC rollup of `presenceSessions` into `presenceDailyRollups`).
  - **8 Core Dashboard & Permission Callables** (governed by `config/deployment-manifest.json` under `userPermissionsV2` with dedicated least-privilege runtime service accounts `pmdash-*@project-manager-dashboar-a067f.iam.gserviceaccount.com` and `maxInstances: 20`):
    - `createDashboardWeek`, `saveDashboardWeekFields`, `saveDashboardProject`, `deleteDashboardProject`, `saveDashboardGanttTemplateSettings`, `saveDashboardGanttWindowSettings`, `setDashboardWeekRelease` (`functions/project-dashboard-writes.js`)
    - `setUserPermissionOverrides` (`functions/user-permissions.js`)
  - **1 Additional Project Callable**: `setDashboardProjectAttention` (`functions/project-dashboard-writes.js`).
  - **8 Executive Milestone Callables** (`functions/executive-milestones.js`):
    - `addExecutiveMilestoneUpdate`, `createExecutiveMilestoneChangeRequest`, `withdrawExecutiveMilestoneChangeRequest`, `decideExecutiveMilestoneChangeRequest`, `applyDirectExecutiveMilestoneChange`, `initializeExecutiveMilestoneLiveTimeline`, `saveExecutiveMilestoneTimelineConfig`, `setExecutiveRagOverride`.
  - **3 UAT-Only Production-to-UAT Week Sync Callables** (`functions/production-week-sync.js`):
    - `syncProductionWeeksToUat`, `getProductionWeekSyncStatus`, `restoreUatWeeksSnapshot`.

---

## 6. Authorization Architecture Across All Five Enforcement Layers

Authorization in PM Dashboard is divided into **five distinct enforcement layers** with different role, capability-override, and document rules. Never treat role recognition, capability overrides, Firestore read access, Firestore direct write access, Callable authorization, and PDF authorization as equivalent.

### 6.1 Layer 1 — Role Recognition & Normalization by Subsystem
1. **Dashboard Access, Firestore Rules, Permission Registry, Dashboard Writes & PDF Access (9 Recognized Roles)**:
   - `firestore.rules` (`normalizeDashboardRole`), `firestore.uat.rules` (`normalizeDashboardRole`), `firestore.shared-backend.rules` (`normalizeDashboardRole`), `js/dashboard-access.mjs` (`DASHBOARD_ROLES`), `js/permission-registry.mjs` (`KNOWN_ROLES`), `functions/permission-registry.js` (`KNOWN_ROLES`), `functions/project-dashboard-writes.js` (`KNOWN_ROLES`), and `pdf-service/src/report-access.js` (`ROLES`) all recognize the **same 9 normalized role strings**:
     `admin`, `pm`, `engineering`, `business`, `sales`, `bd`, `product`, `vip`, `executive`.
   - **Important Fact**: Neither `vip` nor `business` fails closed at the Firestore Rules role-recognition layer or in `permission-registry`. Both `firestore.rules` and `firestore.uat.rules` include `'vip'` and `'business'` in `normalizeDashboardRole(role)`.
   - **`dashboardRole()` Implementation Difference Between Production and UAT Rules**:
     - In `firestore.rules` (Production, lines 24–34), `dashboardRole()` returns the raw stored `users/{email}.role` string (used so `presenceSessions` creation requires `request.resource.data.role == dashboardRole()` byte-for-byte), while `normalizedDashboardRole()` calls `normalizeDashboardRole(...)` (used by `isAdmin()`).
     - In `firestore.uat.rules` and `firestore.shared-backend.rules` (lines 22–26), `dashboardRole()` directly returns `normalizeDashboardRole(...)`.
2. **Executive Milestone Governance Subsystem (7 Active v2.2T Roles; `vip` & `business` Excluded by Default)**:
   - In `js/executive-governance.mjs` (`normalizeExecutiveRole`), `js/executive-timeline-config.mjs`, `functions/executive-milestone-core.js` (`normalizeRole`), and `functions/executive-timeline-config.js`, only **7 roles** are recognized for Executive Milestone governance:
     `admin`, `executive`, `pm`, `engineering`, `sales`, `bd`, `product`.
   - In this subsystem, `'business'` always normalizes to `''` (rejected), and `'vip'` normalizes to `''` unless `{ allowVipBridge: true }` is explicitly passed in the browser helper (`normalizeExecutiveRole('vip', { allowVipBridge: true }) -> 'executive'`).
3. **Frontend Perspective Mapping (`index.html` Profile Difference)**:
   - In the **Production** frontend profile, `index.html` maps legacy `vip` to the Executive perspective (`role === 'vip' || role === 'executive'`) and recognizes `business` in legacy perspective selectors.
   - In the **UAT** frontend profile, `index.html` uses the v2.2T Executive perspective check (`role === 'executive'`) and exposes `sales`, `bd`, and `product` perspective selectors instead of `business`.

### 6.2 Layer 2 — Per-User Capability Overrides (`userPermissions/{email}.overrides`)
- **Authoritative Storage Location**: Per-user capability overrides are stored in **`userPermissions/{email}`** under the map field **`overrides`** (`userPermissions/{email}.overrides`), written exclusively by the Admin-only callable `setUserPermissionOverrides` (`functions/user-permissions.js`) with an immutable audit trail in `userPermissionAudit/{auditId}`. The `users/{email}` document does **not** store a `.permissions` override map.
- **Exact Capability Registry Matrix (`js/permission-registry.mjs` & `functions/permission-registry.js`, lines 8–74)**:
  Not all capabilities can be delegated to all non-admin roles. `can(capability, { role, overrides })` enforces the following exact `roleDefaults`, `delegable`, `adminLocked`, and `grantableRoles` definitions (where `ALL_NON_ADMIN_ROLES` = `['pm', 'engineering', 'business', 'sales', 'bd', 'product', 'vip', 'executive']` and `PM_ONLY` = `['pm']`):

| Capability ID | `roleDefaults` (No Override) | `delegable` | `adminLocked` | `grantableRoles` (`override === true`) | Effective Override Behavior (`can()`) |
|---|---|---|---|---|---|
| **`week.manage`** | `['admin']` | `true` | `true` | `ALL_NON_ADMIN_ROLES` (all 8 non-admin roles) | Admin always `true`; any of the 8 non-admin roles is enabled when `overrides['week.manage'] === true`. |
| **`week.release`** | `['admin', 'pm']` | `true` | `true` | `PM_ONLY` (`['pm']`) | Admin always `true`; `pm` is `true` by default, can be disabled via `overrides['week.release'] === false` or enabled via `true`. **Never grantable to non-PM roles.** |
| **`gantt.manage`** | `['admin']` | `true` | `true` | `ALL_NON_ADMIN_ROLES` (all 8 non-admin roles) | Admin always `true`; any of the 8 non-admin roles is enabled when `overrides['gantt.manage'] === true`. |
| **`project.manage`** | `['admin']` | `true` | `true` | `PM_ONLY` (`['pm']`) | Admin always `true`; **only `pm`** can be granted `project.manage` via `overrides['project.manage'] === true`. Never grantable to other non-admin roles. |
| **`permissions.manage`** | `['admin']` | `false` | `true` | `[]` (none) | Strictly `admin` only; `delegable: false` ignores all overrides. |

- **Firestore Rules Override Evaluation (`firestore.uat.rules` & `firestore.shared-backend.rules`, lines 42–53)**:
  - `weekManageOverride()` reads `get(/databases/$(database)/documents/userPermissions/$(request.auth.token.email)).data.get('overrides', {})` when that document exists (otherwise `{}`).
  - `canManageWeeks()` evaluates to `true` when `isAdmin()` is true **or** `dashboardRole() in ['pm', 'engineering', 'business', 'sales', 'bd', 'product', 'vip', 'executive'] && weekManageOverride() is map && weekManageOverride().get('week.manage', false) == true`.

### 6.3 Layer 3 — Firestore Read Authorization (`firestore.rules` vs `firestore.uat.rules` & `firestore.shared-backend.rules`)
All rules define `hasDashboardAccess()` as `isSignedIn() && request.auth.token.email != null && exists(/databases/$(database)/documents/users/$(request.auth.token.email))`. Exact collection read predicates are:

| Collection / Document Path | `firestore.rules` (Production) Read Rule | `firestore.uat.rules` & `firestore.shared-backend.rules` Read Rule |
|---|---|---|
| **`/users/{userId}`** | `allow read: if hasDashboardAccess();` | `allow read: if hasDashboardAccess();` |
| **`/userPermissions/{email}`** | `allow read: if hasDashboardAccess() && (request.auth.token.email == email || isAdmin());` | `allow read: if hasDashboardAccess() && (request.auth.token.email == email || isAdmin());` |
| **`/userPermissionAudit/{auditId}`** | `allow read: if isAdmin();` | `allow read: if isAdmin();` |
| **`/weeks/{weekId}`** | `allow read: if hasDashboardAccess();`<br/>*(Any user with `hasDashboardAccess()` can read any week document, regardless of `isReleased` or role.)* | `allow read: if hasDashboardAccess() && (canReadDraftWeeks() || canManageWeeks() || resource.data.isReleased == true);`<br/>*(Unreleased weeks where `isReleased != true` are readable only by `admin`, `pm`, or any recognized role holding `userPermissions/{email}.overrides['week.manage'] == true`.)* |
| **`/dashboardSettings/{settingId}`** vs **`/dashboardSettings/team-2-portfolio`** | `match /dashboardSettings/{settingId}`:<br/>`allow read: if hasDashboardAccess();` | `match /dashboardSettings/team-2-portfolio`:<br/>`allow read: if hasDashboardAccess();`<br/>*(Other `dashboardSettings` document IDs have no match block and fail closed.)* |
| **`/logs/{logId}`** | `allow read: if hasDashboardAccess();` | `allow read: if hasDashboardAccess();` |
| **`/presence/{document}`** | `allow read: if hasDashboardAccess();` | `allow read: if hasDashboardAccess();` |
| **`/presenceSessions/{sessionId}`** | `allow read: if isAdmin();` | `allow read: if isAdmin();` |
| **`/presenceDailyRollups/{rollupId}`** | `allow read: if isAdmin();` | `allow read: if isAdmin();` |
| **`/executiveMilestoneConfig/{configId}`** | No match block (fails closed). | `allow read: if hasDashboardAccess();` |
| **`/executiveMilestoneState/{stateId}`** | No match block (fails closed). | `allow read: if hasDashboardAccess();` |
| **`/executiveMilestoneUpdates/{updateId}`** | No match block (fails closed). | `allow read: if hasDashboardAccess() && canViewExecutiveSection(resource.data.sectionId);`<br/>*(Where `canViewExecutiveSection(sectionId)` checks `hasDashboardAccess() && exists(/databases/$(database)/documents/executiveMilestoneConfig/timeline) && dashboardRole() in get(/databases/$(database)/documents/executiveMilestoneConfig/timeline).data.sectionPolicies[sectionId].viewRoles`.)* |
| **`/executiveMilestoneChangeRequests/{requestId}`** | No match block (fails closed). | `allow read: if isAdmin() || isExecutive() || (hasDashboardAccess() && resource.data.requesterEmail == request.auth.token.email);` |
| **`/executiveMilestoneAudit/{auditId}`** | No match block (fails closed). | `allow read: if isAdmin() || isExecutive();` |
| **`/uatProductionWeekSync/{document=**}`** & **`/uatProductionWeekSyncRuns/{document=**}`** | No match block (fails closed). | `allow read, write: if false;` |

### 6.4 Layer 4 — Firestore Direct Client Write Authorization
Direct browser writes via the Firebase client SDK are governed as follows:

1. **Collections Denying All Direct Client Writes (`allow write: if false`)**:
   - `/users/{userId}`
   - `/userPermissions/{email}` and `/userPermissionAudit/{auditId}`
   - `/weeks/{weekId}` (`allow write: if false; allow delete: if false;`)
   - `/presenceDailyRollups/{rollupId}`
   - `/uatProductionWeekSync/{document=**}` and `/uatProductionWeekSyncRuns/{document=**}`
   - `/executiveMilestoneConfig/{configId}`, `/executiveMilestoneState/{stateId}`, `/executiveMilestoneUpdates/{updateId}`, `/executiveMilestoneChangeRequests/{requestId}`, and `/executiveMilestoneAudit/{auditId}`
2. **Authorized Direct Client Writes to `/dashboardSettings/team-2-portfolio` (UAT & Shared-Backend Rules Only)**:
   - In **`firestore.rules` (Production, lines 226–229)**: `match /dashboardSettings/{settingId}` sets `allow write: if false;`. All client writes to `dashboardSettings` are denied in Production rules.
   - In **`firestore.uat.rules` (lines 73–129, 317–322) and `firestore.shared-backend.rules` (lines 73–129, 312–317)**: `match /dashboardSettings/team-2-portfolio` permits direct Admin client writes under exact Gantt template schema predicates:
     - `allow create: if isAdmin() && hasValidGanttTemplateCreate();`
     - `allow update: if isAdmin() && hasValidGanttTemplateUpdate();`
     - `allow delete: if false;`
   - **Exact Schema Enforced by `hasValidGanttTemplateEnvelope`, `hasValidGanttTemplateCreate`, and `hasValidGanttTemplateUpdate`**:
     - Required and only allowed document keys on direct client create/update: **`system`**, **`hardware-module`**, **`revision`**, **`updatedBy`**, and **`updatedAt`**.
     - `system` and `hardware-module` must each satisfy `hasValidGanttTemplateList(values)` (a `list` of 1 to 20 unique, non-empty strings, each of length $\le 128$).
     - `revision` must be an integer $\ge 0$; on `update`, `request.resource.data.revision == resource.data.revision + 1` and `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['system', 'hardware-module', 'revision', 'updatedBy', 'updatedAt'])`.
     - `updatedBy == request.auth.token.email` and `updatedAt == request.time`.
3. **Authorized Direct Client Telemetry Writes**:
   - **`/logs/{logId}`** (`firestore.rules` lines 231–235, `firestore.uat.rules` lines 270–274):
     - `allow create: if hasDashboardAccess() && hasValidAuditLogEnvelope();` (requires exact keys `['eventType', 'actorUid', 'actorEmail', 'createdAt', 'weekId', 'projectCode', 'message', 'context']`, `actorUid == request.auth.uid`, `actorEmail == request.auth.token.email`, `createdAt == request.time`).
     - `allow update, delete: if false;`
   - **`/presence/{document}`** (`firestore.rules` lines 237–246, `firestore.uat.rules` lines 276–285):
     - `allow create: if hasMatchingPresenceIdentity(document) && hasValidNewPresenceEnvelope();`
     - `allow update: if hasMatchingPresenceIdentity(document) && hasOnlyPresenceFields(request.resource.data) && hasValidPresenceFieldTypes(request.resource.data) && keepsOrEstablishesPresenceIdentity();`
     - `allow delete: if false;`
     - Where `hasMatchingPresenceIdentity(document)` requires `hasDashboardAccess() && document == request.auth.token.email && request.resource.data.ownerUid == request.auth.uid && request.resource.data.userKey == request.auth.token.email`.
   - **`/presenceSessions/{sessionId}`**:
     - `allow delete: if false;`
     - In `firestore.rules` (Production, lines 248–269): `create` requires `hasDashboardAccess() && request.auth.token.email != null && hasValidNewPresenceSession(sessionId)` (enforcing 17 exact fields, `role == dashboardRole()`, `environment == 'v2.1'`, timestamps, and TTL bounds); `update` requires `hasDashboardAccess()`, `resource.data.ownerUid == request.auth.uid`, immutable identity fields (`ownerUid`, `userKey`, `sessionId`), `hasValidPresenceSessionUpdate()`, and `affectedKeys().hasOnly(['lastSeenAt', 'endedAt', 'activeMs', 'idleMs', 'state', 'endReason', 'updatedAt'])`.
     - In `firestore.uat.rules` (lines 287–310) and `firestore.shared-backend.rules` (lines 282–305): `create` checks `hasDashboardAccess() && request.resource.data.ownerUid == request.auth.uid && request.resource.data.userKey == request.auth.token.email && request.resource.data.sessionId == sessionId`; `update` checks `hasDashboardAccess()`, `resource.data.ownerUid == request.auth.uid`, immutable `ownerUid`/`userKey`/`sessionId`, and the same 7-key `affectedKeys().hasOnly(...)` restriction.

### 6.5 Layer 5 — Callable Function & PDF Service Authorization
1. **Firebase Callable Functions (`functions/project-dashboard-writes.js`, `user-permissions.js`, `executive-milestones.js`, `production-week-sync.js`)**:
   - Dashboard and permission callables verify `request.auth.uid` and `request.auth.token.email`, read `users/{email}` and `userPermissions/{email}` inside a Firestore transaction (`loadActorInTransaction`), and resolve effective capabilities via `can(capability, { role, overrides })`:
     - `createDashboardWeek`: Requires `actorCan(actor, 'week.manage')`.
     - `saveDashboardWeekFields`: Requires draft week (`isReleased !== true`). Full week-field set (`label`, `dates`, `execSummary`, `Lookahead`, `strategyLayer`, `ganttWindow`, `weeklySummary`) requires `actorCan(actor, 'week.manage')`; a `pm` without `week.manage` may save only `weeklySummary` (`PM_WEEKLY_SUMMARY_FIELDS`).
     - `setDashboardWeekRelease`: Requires `actorCan(actor, 'week.release')` (`admin` or `pm` unless disabled by `week.release: false` override).
     - `saveDashboardGanttTemplateSettings` & `saveDashboardGanttWindowSettings`: Require `actorCan(actor, 'gantt.manage')`.
     - `saveDashboardProject`: Requires draft week (`isReleased !== true`). Creating a new project (`isNew === true`) requires `actorCan(actor, 'project.manage')` (`admin`, or `pm` with `project.manage: true` override). Editing an existing project requires `canMutateProject({ actor, project })` (`admin`, or `pm` matching `project.owner` / `project.deputy`). `assertVisibilityAuthority(actor, draft, liveProject)` enforces that only `admin` can set or alter `project.visibility`.
     - `deleteDashboardProject`: Requires draft week (`isReleased !== true`) and `actorCan(actor, 'project.manage')`.
     - `setDashboardProjectAttention`: Requires draft week (`isReleased !== true`) and `canMutateProject({ actor, project })`.
     - `setUserPermissionOverrides` (`functions/user-permissions.js`): Requires `can('permissions.manage', ...)` (strictly `admin` only).
   - **Executive Milestone Callables (`functions/executive-milestones.js`)**:
     - `getActor()` reads `users/{email}`, requires `active !== false`, and normalizes the role via `normalizeRole()` in `functions/executive-milestone-core.js` (the 7 active v2.2T roles: `admin`, `executive`, `pm`, `engineering`, `sales`, `bd`, `product`).
     - Reads live config from `executiveMilestoneConfig/timeline` and live state from `executiveMilestoneState/live`, writing audit records to `executiveMilestoneAudit/{auditId}`:
       - `initializeExecutiveMilestoneLiveTimeline`: `actor.role === 'admin'` only.
       - `saveExecutiveMilestoneTimelineConfig` & `setExecutiveRagOverride`: `['admin', 'executive']` only.
       - `decideExecutiveMilestoneChangeRequest`: `actor.role === 'executive'` only.
       - `withdrawExecutiveMilestoneChangeRequest`: `changeRequest.requesterEmail === actor.email` only.
       - `addExecutiveMilestoneUpdate`, `createExecutiveMilestoneChangeRequest`, `applyDirectExecutiveMilestoneChange`: Enforced by `applyItemUpdate`, `createChangeRequest`, and `applyDirectStructureChange` in `functions/executive-milestone-core.js` against section `viewRoles` / `updateRoles` in `executiveMilestoneConfig/timeline`.
   - **UAT Week Sync Callables (`functions/production-week-sync.js`)**:
     - Requires `admin` role in UAT `users/{email}` plus strict UAT project boundary verification (`pm-dashboard-uat-20260820-a7f3`).
2. **Cloud Run PDF Service Authorization (`pdf-service/src/report-access.js`, `report-data.js`)**:
   - Authenticates the caller's Bearer token via `firebase-admin/auth` (`verifyIdToken`) and fetches `users/{email}` from Firestore (`getUserByEmail`). On `main` (`4a8e7ee`), `pdf-service` reads `users/{email}` and does **not** read `userPermissions/{email}.overrides`.
   - **`authorizeReportAccess(identity, week)`** (`pdf-service/src/report-access.js`, lines 28–37):
     - Requires a non-empty `identity.email` (`401` if missing) and a role recognized by `normalizeDashboardRole(identity.role)` (`admin`, `vip`, `executive`, `pm`, `engineering`, `business`, `sales`, `bd`, `product`; `403` if invalid).
     - On `main` (`4a8e7ee`), if `['vip', 'executive'].includes(role)` and `week?.isReleased !== true`, throws `ReportAccessError` (`403`). Non-Admin roles also have non-active projects filtered out via `filterVisibleProjectsForRole()` (`project.visibility === 'active'`) in `report-data.js`.
   - **`authorizeExecutiveAudienceView(role, requestedView)`** (`pdf-service/src/report-access.js`, lines 3–13, 39–48):
     - Normalizes `role` via `normalizeDashboardRole(role)` and looks up `EXECUTIVE_VIEWS_BY_ROLE[candidateRole]`:
       - `admin`, `vip`, `executive`: `['leadership', 'all-working-team', 'pm-engineering', 'business-product', 'everyone']`
       - `pm`, `engineering`: `['pm-engineering', 'all-working-team', 'everyone']`
       - `business`, `sales`, `bd`, `product`: `['business-product', 'all-working-team', 'everyone']`
     - If `requestedView === undefined`, selects `allowedViews[0]`; otherwise trims `String(requestedView)` and throws `ReportAccessError` (`403`) if `!allowedViews.includes(selectedView)`.

---

## 7. PDF Service Architecture (`pdf-service/`)

- **Runtime & Target Registry**:
  - `pdf-service/src/targets/registry.json` is the single authoritative registry mapping `uat` and `production` to their Cloud Run `serviceUrl`, `firebaseProjectId`, `allowedOrigins`, build/runtime service accounts, and environment-specific feature flags.
  - Both `pdf-service/src/environment.js` (at container startup/request time) and `scripts/hosting-env.mjs` (at Hosting build time) validate against `registry.json` so Hosting and Cloud Run cannot drift or point across environments.
- **Request & Rendering Pipeline**:
  1. `server.js` / `app.js`: Validates CORS against `allowedOrigins`, verifies the Bearer Firebase ID token (`auth-error.js`), and checks environment feature gates (`report-request.js`).
  2. `report-data.js` & `report-access.js`: Reads `users/{email}` from Firestore to resolve the caller's authoritative role and filters project/week visibility server-side.
  3. `report-model.js`: Normalizes week, project, status, attention category, workstream Gantt window, and summary fields.
  4. `overview-report.js` / `project-report.js` / `project-one-pager.js` / `executive-summary-brief.js`: Generates semantic HTML with `data-pdf-flow-item` and `data-pdf-splittable` attributes.
  5. `pdf-renderer.js` & `measured-paginator.js`: Loads HTML into headless Chromium, measures actual DOM box heights, splits overflowing flow items across pages with continuation headers, and outputs the final PDF buffer.

---

## 8. Shared Module Contracts & Verification Classification

Because Root (`js/`, `shared/`), Cloud Functions (`functions/`), and PDF Service (`pdf-service/`) have separate runtime packaging boundaries, shared contracts are maintained across directories. Engineers must distinguish between:
- **Source Modules** (the implementation files in each runtime directory),
- **Direct Cross-Runtime Parity / Contract Tests** (tests that import both runtimes' modules or shared contract fixtures and verify behavioral equivalence),
- **Local Behavioral Unit Tests** (tests that verify a single runtime's module in isolation), and
- **Package Verification Scripts** (scripts/tests that verify byte-for-byte file copying or SHA-256 checksums, which prevent packaging drift but do **not** by themselves prove functional correctness).

| Domain Contract | Root / Shared Source Module | Functions / PDF Source Module | Cross-Runtime Parity / Contract Tests & Package Guards | Single-Runtime Functional Unit Tests |
|---|---|---|---|---|
| **Delegable Permission Registry & Role Contract** (`week.manage`, `week.release`, `gantt.manage`, `project.manage`, `permissions.manage`) | `js/permission-registry.mjs` & `js/dashboard-access.mjs` | `functions/permission-registry.js` & `functions/project-dashboard-writes.js` | **Direct Cross-Runtime Parity Test**:<br/>`functions/test/permission-registry-parity.test.cjs` *(imports both browser `.mjs` and Functions `.js` modules and asserts identical capability & role outputs)* | `tests/permission-registry.test.mjs`,<br/>`tests/dashboard-access.test.mjs`,<br/>`functions/test/capability-enforcement.test.cjs` |
| **Project Revision Fingerprinting & Row-ID Merge** | `js/project-mutations.mjs` | `functions/project-dashboard-writes.js` & `functions/project-data-merge.cjs` | **Direct Cross-Runtime Parity Test**:<br/>`functions/test/project-dashboard-revision-parity.test.cjs` *(imports both `js/project-mutations.mjs` and `functions/project-dashboard-writes.js` and asserts byte-identical fingerprints)* | `tests/project-mutations.test.mjs`,<br/>`tests/project-mutations.uat.test.mjs`,<br/>`functions/test/project-dashboard-writes.test.cjs` |
| **Week Carryover Logic** | `week-carryover.mjs` | `functions/week-carryover.js` | **Direct Cross-Runtime Parity Test**:<br/>`functions/test/week-carryover-parity.test.cjs` *(imports both `week-carryover.mjs` and `functions/week-carryover.js` and asserts `deepEqual` carryover & deep-clone isolation)* | `week-carryover.test.mjs` *(tests root `week-carryover.mjs` only)* |
| **Weekly Summary Normalization & Validation Contract** | `js/weekly-summary-contract.mjs` | `pdf-service/src/weekly-summary-contract.js` & `pdf-service/src/executive-summary-brief.js` | **Shared-Fixture Cross-Runtime Contract Test**:<br/>`pdf-service/test/executive-summary-brief.test.mjs` *(imports `js/weekly-summary-contract.mjs`, `pdf-service/src/weekly-summary-contract.js`, `pdf-service/src/executive-summary-brief.js`, and shared fixtures in `tests/weekly-summary-*-fixtures.mjs`)* | `tests/weekly-summary-contract.test.mjs`,<br/>`tests/weekly-summary-corpus.test.mjs`,<br/>`tests/weekly-summary-normalization.test.mjs` |
| **Executive Milestone Governance & Timeline Core** | `js/executive-governance.mjs`, `js/executive-timeline-config.mjs`, `executive-timeline-core.js` | `functions/executive-milestone-core.js`, `functions/executive-timeline-config.js`, `functions/executive-live-timeline.js` | *No single cross-import parity test on `main`; verified via parallel behavioral test suites.* | Root: `tests/executive-governance.test.mjs`, `tests/executive-timeline-core.test.mjs`, `tests/executive-timeline-core.uat.test.mjs`<br/>Functions: `functions/test/executive-milestone-core.test.cjs`, `functions/test/executive-live-timeline.test.cjs`, `functions/test/executive-milestones-source.test.cjs` |
| **V2.3 Delivery Trends Engine** *(Branch-Scoped: Track C PR #57 `7c02e7f`, not yet on `main`)* | Authoritative engine: `shared/delivery-trends.mjs`<br/>Browser adapters/views: `js/delivery-trends-adapter.mjs`, `js/delivery-trends-view.mjs`, `js/delivery-trends-page.mjs` | Generated copy: `pdf-service/src/generated/delivery-trends.mjs` + `pdf-service/src/generated/delivery-trends.sha256`<br/>PDF renderer: `pdf-service/src/delivery-performance-report.js` | **Cross-Runtime Contract & Parity Tests** *(functional)*:<br/>`pdf-service/test/delivery-parity.test.mjs`, `tests/delivery-trends-presentation-contract.test.mjs`<br/>**Package Verification Scripts & Test** *(artifact sync/checksum only, not functional proof)*:<br/>`scripts/package-delivery-trends.mjs`, `pdf-service/src/verify-delivery-trends-package.mjs`, `tests/delivery-trends-packaging.test.mjs` | Root engine & UI unit tests:<br/>`tests/delivery-trends.test.mjs`, `tests/delivery-trends-adapter.test.mjs`, `tests/delivery-trends-view.test.mjs`, `tests/delivery-trends-page.test.mjs`<br/>PDF report & integration tests:<br/>`pdf-service/test/delivery-performance-report.test.mjs`, `pdf-service/test/delivery-performance-integration.test.mjs` |

---

## 9. Production Security Invariants

Every change to this repository must preserve the following invariants:

1. **Production Function Baseline Invariant (`e1f0e5c`)**:
   - `tests/dashboard-profile-invariants.test.mjs` extracts every function from `dashboardSource('production')` via `functionInventory()` and asserts byte-for-byte equality with `tests/fixtures/dashboard-baselines.json` (`e1f0e5c`), except functions explicitly registered in `DELIBERATE_PRODUCTION_EXCEPTIONS` with companion behavioral tests.
2. **Multi-Layer Cross-Environment Isolation**:
   - **Config & Registry Validation (`scripts/hosting-env.mjs`)**: `loadHostingEnv()` validates `env/<name>.json` by enforcing:
     1. Firebase Project ID allowlist equality (`env.firebaseProjectId === HOSTING_TARGETS[name]`).
     2. Origin consistency with the URL constructed from `hostingSite` (`env.hostingOrigin === https://${env.hostingSite}.web.app`).
     3. PDF service URL equality with the authoritative endpoint registered for that environment in `pdf-service/src/targets/registry.json` (`env.pdfServiceUrl === registeredPdfServiceUrl`).
   - **Build Output Project-ID Scan (`scripts/build-hosting.mjs`)**: `assertNoCrossEnvironmentLeak()` scans every built file in `dist/` to guarantee a `prod` build never contains the UAT Firebase project ID string (`pm-dashboard-uat-20260820-a7f3`) and a `uat` build never contains the Production Firebase project ID string (`project-manager-dashboar-a067f`).
   - **PDF Runtime Environment & CORS Guard (`pdf-service/src/environment.js`, `cors.js`)**: Enforces at container startup and per-request that `PDF_ENVIRONMENT`, `FIREBASE_PROJECT_ID`, and `ALLOWED_ORIGIN` match the target entry in `pdf-service/src/targets/registry.json`.
3. **Server-Side Visibility & Ownership Authority**:
   - In `functions/project-dashboard-writes.js` (`saveDashboardProject`), non-Admin users can never alter project `visibility` (new projects must start `active`; edits must echo live `visibility`). The `project.manage` capability grants project create/delete to `pm` (or `admin`) only, never `visibility` authority (`functions/test/project-visibility-authority.test.cjs`).
4. **Deploy Order Invariant (Functions Before Restrictive Rules)**:
   - Because browser writes to protected collections are denied by Firestore Rules, new or updated Callable Functions must always be deployed and verified before deploying restrictive Firestore Rules.
5. **Four-Identity Execution Freeze (`config/deployment-manifest.json`)**:
   - Production promotions enforce four distinct identities: `runtimeTargetSourceSha`, external post-merge `REVIEWED_RELEASE_PLAN_SHA`, clean detached checkout equal to that reviewed SHA, and an independently pinned `rollbackBaseline` (`tests/production-promotion-v2.test.mjs`).
6. **Production-to-UAT Sync Boundary (`config/production-week-sync-boundary.json`)**:
   - Verified by `npm run verify:sync-boundary` (`scripts/verify-production-sync-boundary.mjs`). Production is strictly read-only (`roles/datastore.viewer` on `project-manager-dashboar-a067f`), limited to the `weeks` collection, and writes only to UAT (`pm-dashboard-uat-20260820-a7f3`) with mandatory pre-sync snapshots and automatic rollback verification.
7. **Legacy Persistence Namespace Compatibility**:
   - `team2.portfolioScope`, `team2.overviewScope.*`, and `dashboardSettings/team-2-portfolio` are active Firestore/localStorage data-compatibility identifiers and must not be renamed without an approved data migration.

---

## 10. Known Architectural Limitations

1. **Monolithic `index.html` (~13,669 Lines)**:
   - High concentration of HTML markup, CSS, Firestore `onSnapshot` listeners (`initData`), and view rendering (`render`, `renderNormal`, `renderExec`) in a single file creates frequent merge hotspots when multiple tracks add UI features concurrently.
2. **Whole-File UAT Hash Pinning (`originalUatHash`)**:
   - `tests/role-contract.test.mjs` pins a single SHA-256 hash (`originalUatHash`) computed across the entire UAT-rendered `index.html`. Similarly, feature-stripping tests (such as `tests/delivery-trends-integration.test.mjs` in Track C) assert that stripping a single feature's `@uat-only` tags reproduces the exact full-file SHA-256 of `main`. Consequently, any two UAT feature branches that touch `index.html` will deterministically conflict on `originalUatHash` and fail each other's full-file stripping hash assertion upon integration, even when their functional changes are orthogonal.
3. **Unstripped `@uat-only` Code in Built `dist/index.html`**:
   - Because `scripts/build-hosting.mjs` copies `index.html` verbatim, UAT feature markup and script blocks remain present (though inert behind `IS_UAT_PROFILE` and `data-profile-only="uat"`) in the static HTML served to browsers. Confidentiality and write protection therefore rely on server-side Functions, Firestore Rules, and Cloud Run environment gating rather than client source stripping.
4. **Full-Document `weeks` Read Granularity & Unreleased Week Exposure in Production Rules**:
   - In `firestore.rules` (Production), `match /weeks/{weekId}` allows `read: if hasDashboardAccess()`, so any signed-in user with a `users/{email}` record can read any `weeks/{weekId}` document at the Firestore rule layer (including unreleased draft weeks and all three embedded Executive sections inside `strategyLayer`). Furthermore, as documented in `README.md`, Firestore Rules cannot redact individual fields of a readable `weeks/{weekId}` document, and the schema has no server-protected active-week setting to distinguish the latest unreleased draft week from an older unreleased draft week.
5. **Apple Silicon Host Constraints vs Linux CI**:
   - Local macOS environments without a Java runtime cannot run `npm run test:rules` locally, and `linux/amd64` Chromium Docker smoke steps inside `pdf-service` may hit Rosetta ELF emulation errors locally; GitHub Actions Ubuntu CI (`ci.yml`) is the authoritative gate for those two checks.

---

## 11. Lightweight Multi-Track Integration Policy

To support parallel feature development without freezing active tracks or introducing permanent branch overhead:

1. **Worktree & Branch Isolation (Zero Interference with Local Work)**:
   - Each feature track develops in its own dedicated Git worktree and branch (`codex/<feature>`, `claude/<feature>`). Developers never modify or rebase another track's active branch or worktree.
   - Shared-environment provenance and cross-track preservation gates apply **only when deploying to shared UAT or Production environments**; they never block independent local coding, worktree experimentation, or feature-branch CI runs.
2. **Stacked PR Consolidation at Gate Boundaries**:
   - When a multi-phase feature uses stacked PRs (such as V2.3 PRs #50–#57), the top Gate closeout branch (e.g., PR #57 `claude/v23-gate2-closeout`) serves as the single integration base for that track once upstream phases are merged into it.
3. **Non-Destructive Conflict Pre-Screening (`git merge-tree`)**:
   - Before scheduling an integration or UAT deployment, run three-way in-memory merge simulations (`git merge-tree $(git merge-base A B) A B`) across active tracks to identify textual overlaps, `originalUatHash` collisions, and semantic interactions without altering any working tree.
4. **Ephemeral Gate-Scoped Integration Branches (`integration/<scope>`)**:
   - Do not maintain permanent long-lived integration branches. Create a targeted `integration/<scope>` branch in a clean worktree **only** when:
     - Two tracks must be deployed together to a shared UAT surface (e.g., combining a UAT feature candidate with a PDF hotfix so neither overwrites the other on UAT Cloud Run or UAT Hosting), or
     - Preparing conflict resolution between two tracks after one has passed its acceptance gate.
5. **Cross-Track Feature Preservation on Shared Environments**:
   - UAT Hosting (`pm-dashboard-uat-20260820-a7f3`), UAT Cloud Run (`pm-dashboard-uat-pdf`), and UAT Functions are shared singleton surfaces. Never deploy directly from an unmerged branch if doing so would silently regress another active track already under UAT evaluation; every shared-environment deployment must complete the `CROSS_TRACK_FEATURE_PRESERVATION` verification in `docs/RELEASE_PROVENANCE_CHECKLIST.md` (Section 3).

---

# Part II — Dated Operational Snapshot

## Appendix A — Active Development Dependency & Conflict Snapshot (Dated: 2026-10-16)

> **Operational Snapshot Notice**: This appendix records the verified state of active development tracks as of **2026-10-16**. Branch SHAs, open PRs, and cloud revisions change over time as tracks progress; use the classified inspection commands in Section A.4 to obtain live state before making integration or release decisions.

### A.1 Active & Tracked Development Branches (Snapshot: 2026-10-16)

| Track / PR | Branch (`head` $\rightarrow$ `base`) | Verified HEAD SHA (2026-10-16) | Merge-Base with `main` (`4a8e7ee`) | Status Classification | Summary & Deployment Scope |
|---|---|---|---|---|---|
| **Track A**<br/>**PR #60** | `codex/pdf-attention-consistency-hotfix` $\rightarrow$ `main` | `a560292beca4746e8cdec240103b20752395f2dd` | `4a8e7ee` | **ACTIVE (Draft PR, CI 5/5)** | Fixes PDF `attention` boolean-flag override bug in `pdf-service/src/report-model.js` and overflowing risk-table pagination in `pdf-service/src/measured-paginator.js`. Includes `docs/rca/pdf-uat-source-preservation.json`. |
| **Track B**<br/>**PR #54** | `codex/new-project-draft-publish` $\rightarrow$ `main` | `4be45fb07dfc6656fcfebedb4874e2488b41e801` | `4a8e7ee` | **ACTIVE (Draft PR, CI 5/5)** | Unifies UAT project editor (`Save Draft` / `Save & Publish`) with atomic publishing, adds 4 UAT-only draft callables (`projectDrafts`), and restores Archive lifecycle management outside Draft Publish. |
| **Track C (Base)**<br/>**PR #57** | `claude/v23-gate2-closeout` $\rightarrow$ `integration/v23-e2e-candidate` | `7c02e7f44e4aac72c9a1a948512ea2bdbcdbd940` | `4a8e7ee` | **ACTIVE (Stacked Draft PR, CI 5/5)** | V2.3 Delivery Trends Gate 2 closeout: consolidates PRs #50, #51, #52, #53, #55, #56; adds F-1 draft-history authorization (`admin`/`pm` only), chronological ISO week ordering, 2-column PDF footnotes, and web/PDF warning dictionary parity. Feature flags OFF. |
| **Track C (Backend)**<br/>**PR #58** | `claude/v23-uat-backend-activation` $\rightarrow$ `claude/v23-gate2-closeout` | `0ad92930682d86fb009b1a3f9bcbb0e669c348cd` | `4a8e7ee` (Base: `7c02e7f`) | **ACTIVE (UAT Release Candidate, CI 5/5)** | Enables `deliveryPerformanceSection: true` for `uat` in `pdf-service/src/targets/registry.json` on top of PR #57 (code commit `7cc502d`) + adds `UAT_RELEASE_RUNBOOK.md`. |
| **Track C (Frontend)**<br/>**PR #59** | `claude/v23-uat-frontend-activation` $\rightarrow$ `claude/v23-gate2-closeout` | `1473475e78e5ff0ae9a466398ae98d35a588e117` | `4a8e7ee` (Base: `7c02e7f`) | **ACTIVE (UAT Release Candidate, CI 5/5)** | Enables `DELIVERY_PERFORMANCE_PDF_BACKEND_VERIFIED = true` for the UAT profile in `js/overview-pdf-selection.mjs` on top of PR #57. |
| **Track C (Upstream Stack)**<br/>**PRs #50, #51, #52, #53, #55, #56** & `integration/v23-foundation` | `#50` (`cd573dc`), `#51` (`e881761`), `v23-foundation` (`83a56b1`), `#52` (`c8cd5d8`), `#53` (`e06da6e`), `#55` (`669ab2d`), `#56` (`aed4e72`) | See column 2 | `4a8e7ee` | **STACKED INTO PR #57 (CI 5/5)** | Upstream phase branches of V2.3 Delivery Trends. All code and tests from these branches are already integrated into PR #57 (`7c02e7f`). Preserved open/untouched per governance policy. |
| **Track D (UCG V2)**<br/>*(No PR)* | `origin/feat/ucg-v2-uat-integration` (merges `origin/claude/gifted-bardeen-1m9ugt` `3eba2f9`) | `16b8dfb675823ebca0d48c0271f5ef85e8cf9933` | `0da8d85` (2026-09-28) | **UNMERGED FEATURE TRACK** | Usage & Cost Guard (UCG) V2 capacity outlook, Pacific-anchored daily writes history, and runtime config (15 files changed, +3,637/-101). Preserved for future scheduling. |
| **PR #36** | `claude/production-user-permissions-promotion` $\rightarrow$ `main` | `3a9a728b2dcbf79b5f4536498580e3cbdb9407a4` | `606fe7e` (PR #35) | **OPEN / CONFLICTING (V1 Promotion)** | Prepared initial User Permissions (V1) Production promotion. Subsequent User Permissions V2 promotion plans (PR #41 `fb956ef`, PR #46 `8301b2b`) were merged into `main`. Retained untouched pending Control Plane disposition. |
| **PR #37** | `claude/production-pages-user-permissions` $\rightarrow$ `production-pages` | `febf2cf85a9188652aaadecfc0c6e3882c7178ac` | `932c6e2` (`production-pages` PR #32) | **OPEN / CONFLICTING (V1 Pages Port)** | Prepared initial User Permissions (V1) port to `production-pages`. Subsequent User Permissions V2 port (PR #40 `015e8b2`) was merged into `production-pages` (`a9648a1`). Retained untouched pending Control Plane disposition. |
| **Older Risk Terminology Branches** | `origin/release/pdf-risk-mitigation-terminology-prod` (`4b9c41d`), `origin/release/risk-mitigation-terminology-prod` (`e785142`), `origin/integrate/risk-mitigation-actions-current-main` (`8da1a7c`), `origin/fix/risk-mitigation-actions-label` (`82dea1d`) | `4b9c41d`, `e785142`, `8da1a7c`, `82dea1d` | `06a5afa` ~ `8ceb42d` | **HISTORICAL / PATCH-EQUIVALENT** | `git cherry` confirms `8da1a7c` and `82dea1d` are patch-equivalent to commits in `main` (PR #21 `94087e0`), and `e785142` is an ancestor of `origin/production-pages`. `4b9c41d` predates UAT `project-brief` splitting on `main`. Retained untouched. |

### A.2 Shared-File Hotspots Across Active Tracks (Snapshot: 2026-10-16)

| Shared File | Modified By Active Tracks | Conflict / Coupling Mechanism |
|---|---|---|
| `index.html` | **PR #54**, **PR #57** (#50/#53/#55/#56), **UCG V2 (`16b8dfb`)**, **PR #37** | Direct textual conflict in `initData` (`onSnapshot(weeksQuery)` week sorting: PR #54 keeps `sortWeeksByLabel(fetchedWeeks)`, while PR #57 replaces it with `buildPrototypeWeeks()` + `sortWeeksChronologically(fetchedWeeks)`). |
| `tests/role-contract.test.mjs` | **PR #54**, **PR #57** (#53/#55/#56), **PR #37** | Direct textual conflict on line 20 (`const originalUatHash = '...'`), which hashes the entire UAT-profile `index.html`. |
| `tests/delivery-trends-integration.test.mjs` | **PR #57** / **PR #59** *(broken semantically if merged with **PR #54** or **UCG V2**)* | Strips only V2.3 `@uat-only` markers from `index.html` and asserts the remaining full-file SHA-256 equals `e83cb180...` (`main` @ `4a8e7ee`). Merging any other UAT feature into `index.html` changes that stripped hash. |
| `pdf-service/src/report-model.js` | **PR #60**, **PR #57** (#52/#56) | PR #60 modifies `attentionFor()` and `normalizeProjectForReport()` (lines 80–170); PR #57 adds `deliveryTrends` validation/passthrough later in the file. Auto-merges cleanly (`0` conflict blocks) but shares report model execution path. |
| `pdf-service/test/delivery-feature-gate.test.mjs` | **PR #58**, **PR #59** | Both modify different assertions in the same test file on top of PR #57 (`0` conflict blocks in 3-way `git merge-tree`). |
| `config/deployment-manifest.json` & `tests/deployment-manifest.test.mjs` | **PR #54**, **PR #36** | PR #54 adds 4 UAT-only draft callables to the UAT/Prod boundary rules; PR #36 modifies the older V1 `userPermissions` release block (3–4 textual conflict blocks against `main` and PR #54). |
| `tests/dashboard-profile-invariants.test.mjs` | **UCG V2 (`16b8dfb`)**, `main` | UCG V2 modifies `DELIBERATE_PRODUCTION_EXCEPTIONS` against an older `0da8d85` base (1 textual conflict block with `main` @ `4a8e7ee`). |

### A.3 Verified Cross-Track Conflict Summary (Snapshot: 2026-10-16)

| Track Pair | Textual Conflict (`git merge-tree`) | Semantic / Test Conflict | Deployment Dependency / Hazard |
|---|---|---|---|
| **PR #60 (`a560292`) + PR #57 (`7c02e7f`) / PR #58 (`0ad9293`)** | **0 conflicts** (1 overlapping file: `pdf-service/src/report-model.js`) | Compatible. Resolves the `1/83` warning dictionary test mismatch noted when PR #60 was tested outside PR #57's root tree. | **Critical UAT Dependency**: Service-level Cloud Run metadata observed on 2026-10-16 reported revision `pm-dashboard-uat-pdf-pr60-a560292`, while PR #60's preserved-source manifest (`docs/rca/pdf-uat-source-preservation.json`) matches the 35-file combination of PR #58 + PR #60 (though per-revision metadata and unpacked container image contents remain `UNKNOWN`; see `docs/RELEASE_PROVENANCE_CHECKLIST.md` Section 6). Deploying either PR #58 or PR #60 alone from its branch would regress the other's changes in UAT. |
| **PR #54 (`4be45fb`) + PR #57 (`7c02e7f`)** | **2 conflict blocks** (`index.html`, `tests/role-contract.test.mjs`) | **Semantic Conflict**: `sortWeeksByLabel` vs `sortWeeksChronologically` in `index.html`, plus `originalUatHash` and `delivery-trends-integration.test.mjs` full-file hash assertions. | **UAT Hosting Exclusivity**: Both modify `index.html` for UAT Hosting. Keep PR #54 isolated from the V2.3 UAT release candidate until the designated acceptance gate passes. |
| **PR #60 (`a560292`) + PR #54 (`4be45fb`)** | **0 conflicts** (0 overlapping files) | None (completely orthogonal directories). | None (PDF Cloud Run vs Hosting/Functions). |
| **PR #58 (`0ad9293`) + PR #59 (`1473475`)** | **0 conflicts** (1 overlapping file: `pdf-service/test/delivery-feature-gate.test.mjs`) | Complementary Gate 3B backend/frontend activation flags. | **Deploy Order**: Backend (PR #58 + PR #60) must be verified serving before Frontend (PR #59) is deployed to UAT Hosting. |

### A.4 Classified Commands for Refreshing This Inventory (Class A vs Class B)

Commands are strictly classified by whether they mutate local or remote state (see `docs/RELEASE_PROVENANCE_CHECKLIST.md` Section 5 for the full Class A / B / C taxonomy):

#### Class A — Strictly Read-Only Commands (Zero Local or Remote State Mutation)
Safe to run during strict read-only audits; these commands inspect existing local `.git` objects or query GitHub APIs without altering any local files or refs:

```bash
# 1. List all currently fetched remote branches unmerged into origin/main sorted by commit date (Local Git read-only)
git for-each-ref --no-merged=origin/main --sort=-committerdate refs/remotes/origin/ \
  --format='%(committerdate:short) | %(refname:short) | %(objectname) | %(subject)'

# 2. Run non-destructive 3-way merge simulation in memory using 3-arg git merge-tree (Local Git read-only; writes no objects)
BASE=$(git merge-base origin/codex/new-project-draft-publish origin/claude/v23-gate2-closeout)
git merge-tree "$BASE" origin/codex/new-project-draft-publish origin/claude/v23-gate2-closeout | grep -E '^(changed in both|\+<<<<<<< )'

# 3. Query open PRs from GitHub API without modifying local refs (Remote API read-only; requires network/auth)
gh pr list --state open --limit 50 \
  --json number,title,isDraft,headRefName,headRefOid,baseRefName,updatedAt,mergeable \
  --jq '.[] | "\(.number) | draft=\(.isDraft) | \(.baseRefName) <- \(.headRefName) | \(.headRefOid) | \(.mergeable) | \(.title)"'
```

#### Class B — Local-State-Mutating Refresh Commands (Prohibited During Strictly Read-Only Repository Audits)
`git fetch` updates and prunes local remote-tracking refs under `.git/refs/remotes/origin/` and writes downloaded packfiles into `.git/objects/`. Run only when updating local remote-tracking refs is permitted:

```bash
# Updates local refs/remotes/origin/* from remote repository (Class B — mutates local .git refs)
git fetch origin --prune
```
