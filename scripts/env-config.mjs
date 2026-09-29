// Renders the browser-side environment file (env-config.js) from an env/<name>.json declaration.
// The committed env-config.js is the Production rendering; the Hosting build writes dist/env-config.js.

// Filters an env/<name>.json usageCostGuard.<service> declaration down to exactly the non-sensitive
// fields the browser is allowed to see (UCG-V2-2B Control Plane decision 6): the configured cap
// amount and its manualConfig provenance. Never a Billing account id, service account, IAM data, or
// any privileged endpoint -- those are never present in env/*.json's usageCostGuard block, and this
// function would not pass them through even if they were, since it only reads these four keys by name.
function normalizeCapConfig(cap) {
  if (!cap) return null;
  return {
    configuredCapSgd: cap.configuredCapSgd ?? null,
    source: cap.source ?? null,
    trustLevel: cap.trustLevel ?? null,
    verifiedAt: cap.verifiedAt ?? null,
  };
}

// Single source of truth for the browser-exposed Usage & Cost Guard config shape, shared by the
// real renderer below and by the test harness (tests/helpers/dashboard-source.mjs) that reproduces
// index.html's per-profile view, so both stay in lockstep with exactly the same field selection.
export function normalizeUsageCostGuardConfig(usageCostGuard) {
  return {
    cloudRun: normalizeCapConfig(usageCostGuard?.cloudRun),
    cloudRunFunctions: normalizeCapConfig(usageCostGuard?.cloudRunFunctions),
  };
}

function renderCapConfigLiteral(cap, indent) {
  if (!cap) return 'null';
  return `Object.freeze({\n` +
    `${indent}  configuredCapSgd: ${JSON.stringify(cap.configuredCapSgd)},\n` +
    `${indent}  source: ${JSON.stringify(cap.source)},\n` +
    `${indent}  trustLevel: ${JSON.stringify(cap.trustLevel)},\n` +
    `${indent}  verifiedAt: ${JSON.stringify(cap.verifiedAt)}\n` +
    `${indent}})`;
}

export function renderEnvConfig(env) {
  const config = Object.entries(env.firebaseConfig)
    .map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)
    .join(',\n');
  const usageCostGuard = normalizeUsageCostGuardConfig(env.usageCostGuard);
  return `// Environment configuration read by index.html before anything else runs.
// Generated from env/${env.environment}.json by scripts/env-config.mjs; do not edit by hand.
// The committed default is the PRODUCTION profile, so a plain checkout (GitHub Pages, local serving) can only
// ever behave as Production. The Hosting build writes dist/env-config.js for the target environment, and
// index.html refuses to start when this file is missing or names an unknown profile.
window.PM_DASHBOARD_ENV = Object.freeze({
  dashboardProfile: ${JSON.stringify(env.dashboardProfile)},
  environment: ${JSON.stringify(env.environment)},
  release: ${JSON.stringify(env.release)},
  baseCommit: ${JSON.stringify(env.baseCommit)},
  // null until this environment's dedicated PDF Cloud Run service is deployed and verified; professional-pdf-config.js
  // refuses cleanly (never falls back to another environment's service) when this is null.
  pdfServiceUrl: ${JSON.stringify(env.pdfServiceUrl ?? null)},
  // Non-sensitive Usage & Cost Guard configuration only (UCG-V2-2B): configured cap + manualConfig
  // provenance per service. No spend data, no Billing account id, no credentials -- see
  // normalizeCapConfig above for the exact field allowlist.
  usageCostGuard: Object.freeze({
    cloudRun: ${renderCapConfigLiteral(usageCostGuard.cloudRun, '    ')},
    cloudRunFunctions: ${renderCapConfigLiteral(usageCostGuard.cloudRunFunctions, '    ')}
  }),
  firebaseConfig: Object.freeze({
${config}
  })
});
`;
}
