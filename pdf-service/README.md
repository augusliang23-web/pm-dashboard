# Professional PDF service

This Cloud Run service renders professional project and Overview reports in memory and returns them as download attachments. It does not create Cloud Storage objects, Firestore report records, or persistent PDF files.

## Production boundary

- Browser: sends only report selections and a Firebase ID token.
- Cloud Run: accepts `POST` only after an exact-origin CORS check and Firebase token verification.
- Firestore: report data is read server-side under the `pm-dashboard-pdf` runtime service account, which has `roles/datastore.viewer` only.
- Browser: receives a Blob download and immediately revokes its object URL.

The Cloud Run service uses public ingress so an authenticated GitHub Pages browser can reach it. Public ingress does not grant report access: every report endpoint verifies the Firebase ID token and Dashboard role before it reads report data.

## Current v2.1 deployment

- Service: `pm-dashboard-pdf` (Production, deployed) / `pm-dashboard-uat-pdf` (UAT, **not yet deployed** — see below)
- Region: `asia-southeast1`
- Allowed browser origins, runtime service account, and Firebase project per environment are the versioned
  `src/targets/registry.json`, not this file. `../professional-pdf-config.js` and `../env/<env>.json` read the
  deployed service's URL from that same registry; it is an endpoint, not a secret.

### Authoritative deployment entrypoint

Every deploy — UAT or Production — goes through `scripts/deploy-pdf.mjs`. It is the only script that derives
`PDF_ENVIRONMENT`, `FIREBASE_PROJECT_ID`, and `ALLOWED_ORIGIN` from the target registry and writes them as a
complete environment replacement, which is what `src/environment.js` requires at startup. Do not hand-build a
`gcloud run deploy` command outside this script: a manually-assembled command is exactly how the registry and the
running service's environment previously drifted apart.

Always review a target with `--dry-run` first — it prints the exact `gcloud` command and environment file without
starting `gcloud`:

```sh
node scripts/deploy-pdf.mjs --target uat --dry-run
node scripts/deploy-pdf.mjs --target production --dry-run
```

Deploy UAT (the working tree must be clean; UAT needs no extra confirmation flag):

```sh
node scripts/deploy-pdf.mjs --target uat
```

Deploy Production (requires the explicit confirmation flag; without it the script refuses before touching `gcloud`):

```sh
node scripts/deploy-pdf.mjs --target production --confirm-production
```

The deployer needs permission to deploy Cloud Run and update service IAM. The runtime service account named in the
registry for the target environment must already exist with the Firestore `roles/datastore.viewer` role — the
script does not create service accounts or grant IAM.

**UAT status:** `src/targets/registry.json`'s `uat.serviceUrl` and `../env/uat.json`'s `pdfServiceUrl` are both
`null`. No UAT Cloud Run deployment has happened yet. The UAT dashboard build will show "NOT READY FOR RELEASE"
for PDF export until a real UAT deploy completes and both files are updated to the same resulting URL.

### Windows entrypoint

`deploy.ps1` is a thin compatibility wrapper: it takes the same `-Target`, `-DryRun`, and `-ConfirmProduction`
flags and delegates straight to `scripts/deploy-pdf.mjs`. It holds no project, service, or `gcloud` configuration
of its own, so it cannot drift out of sync with the registry the way the old script did.

**Real PDF deployment on Windows is not supported by this release.** Running `gcloud` on Windows requires
launching its `gcloud.cmd` shim through a shell, and Node's `shell: true` option does not individually escape or
quote arguments the way this project previously and incorrectly documented — real Windows execution of gcloud has
therefore never actually been proven safe or exercised here. `scripts/deploy-pdf.mjs` refuses any real deploy
(UAT or Production) with a clear error the moment it detects it is running on Windows, before it touches git or
gcloud at all. This check follows the operating system the Node process actually runs on, so `deploy.ps1` launched
under PowerShell Core on macOS/Linux is unaffected — only real Windows execution is blocked.

`-DryRun` remains fully supported on every platform, including native Windows, since it never invokes `gcloud`:

```powershell
./deploy.ps1 -Target uat -DryRun
./deploy.ps1 -Target production -DryRun
```

A real deploy (`-Target uat` or `-Target production -ConfirmProduction`, without `-DryRun`) only succeeds when run
on macOS or Linux — use the validated macOS/Linux deployment path there, or from CI. A future, dedicated
Windows-support PR may implement and prove real Windows deployment safely; this release deliberately does not
attempt it.

## Company GitHub migration

Moving only the source code to a company GitHub repository is supported. The existing Cloud Run service and Firebase project continue to work as long as:

1. `professional-pdf-config.js` keeps the current service URL.
2. If the new GitHub Pages hostname changes, update the origin (scheme + host only; no repository path) in
   `src/targets/registry.json` for the affected environment, then redeploy that environment with
   `scripts/deploy-pdf.mjs` so the running service's `ALLOWED_ORIGIN` and the registry stay in agreement.
3. Keep the Firebase project configuration and authorized sign-in domain aligned with the new site.

No credentials, service-account keys, or generated PDFs are stored in this repository.

## Dashboard-style reports and resource limits

Both report modes use the same server-side dashboard print theme. Project reports support project brief, project update, milestone timeline, Gantt, team allocation, discipline hours, and budget. Overview reports support portfolio health, weekly trends, executive summary, attention matrix, risk actions, quarterly roadmap, project portfolio, resource analytics, and budget overview.

The implementation keeps output and free-tier use bounded:

- representative all-section PDFs target 1.5 MiB or less;
- output above 8 MiB is discarded before response headers are sent;
- weekly trend history is queried only when selected and is limited to six weeks;
- warm Cloud Run instances reuse Chromium, while every request page is isolated and closed;
- deployment keeps no minimum instance, one maximum instance, concurrency 1, one CPU, 1 GiB memory, and a 120-second timeout;
- system fonts, HTML, CSS, and inline SVG replace remote assets and raster dashboard captures.

Render deterministic local samples with:

```powershell
npm run render:samples
```

The command writes `../tmp/pdf-samples/project.pdf` and `../tmp/pdf-samples/overview.pdf` for local visual inspection, verifies the 1.5 MiB target, and closes its Chromium process. The Dockerfile copies neither `scripts/` nor `tmp/`, so these development artifacts cannot be part of the production image. Do not commit the generated files.
