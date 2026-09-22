// Renders the browser-side environment file (env-config.js) from an env/<name>.json declaration.
// The committed env-config.js is the Production rendering; the Hosting build writes dist/env-config.js.
export function renderEnvConfig(env) {
  const config = Object.entries(env.firebaseConfig)
    .map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)
    .join(',\n');
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
  firebaseConfig: Object.freeze({
${config}
  })
});
`;
}
