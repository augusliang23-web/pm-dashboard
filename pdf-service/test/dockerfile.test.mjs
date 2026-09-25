import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const deploymentScript = readFileSync(new URL('../deploy.ps1', import.meta.url), 'utf8');

test('PDF renderer image installs the Chromium shared-library dependencies', () => {
  assert.match(dockerfile, /apt-get install -y[\s\S]*libglib2\.0-0/);
  assert.match(dockerfile, /apt-get install -y[\s\S]*libnss3/);
  assert.match(dockerfile, /apt-get install -y[\s\S]*libgbm1/);
  assert.match(dockerfile, /apt-get install -y[\s\S]*libxcursor1/);
  assert.match(dockerfile, /apt-get install -y[\s\S]*libxi6/);
  assert.match(dockerfile, /apt-get install -y[\s\S]*libxss1/);
  assert.match(dockerfile, /apt-get install -y[\s\S]*libxtst6/);
  assert.match(dockerfile, /RUN node --input-type=module -e[\s\S]*puppeteer\.launch/);
});

test('PDF renderer image pins the Node 24.21.0 runtime, not Node 20', () => {
  assert.match(dockerfile, /^FROM node:24\.21\.0-bookworm-slim$/m);
  assert.doesNotMatch(dockerfile, /node:20-/);
});

test('PDF renderer image installs dependencies reproducibly from the committed lockfile', () => {
  // Both package.json and package-lock.json must be copied into the dependency layer before install, and the
  // install itself must be `npm ci` (exact lockfile resolution), never `npm install` (which can silently drift
  // resolved versions within the declared semver ranges on every rebuild).
  assert.match(dockerfile, /^COPY package\.json package-lock\.json \.\/$/m);
  assert.match(dockerfile, /^RUN npm ci --omit=dev$/m);
  assert.doesNotMatch(dockerfile, /npm install --omit=dev/);
  assert.doesNotMatch(dockerfile, /npm update/);
});

test('Cloud Run source deploy excludes local dependencies and development artifacts', () => {
  const ignore = readFileSync(new URL('../.gcloudignore', import.meta.url), 'utf8');

  assert.match(ignore, /^node_modules\/$/m);
  assert.match(ignore, /^test\/$/m);
  assert.match(ignore, /^scripts\/$/m);
  assert.match(ignore, /^npm-debug\.log$/m);
});

test('deploy.ps1 is a thin wrapper that delegates to the authoritative Node deploy script', () => {
  // deploy.ps1 must not carry its own independent gcloud configuration (project id, service name, region,
  // service account, Cloud Run flags): every one of those decisions belongs to scripts/deploy-pdf.mjs and its
  // versioned target registry. A second, independently-editable copy of that configuration is exactly what let
  // deploy.ps1 drift out of sync with src/environment.js's startup validation in the first place.
  assert.match(deploymentScript, /scripts[\\/]deploy-pdf\.mjs/);
  assert.doesNotMatch(deploymentScript, /gcloud/);
  assert.doesNotMatch(deploymentScript, /project-manager-dashboar-a067f/);
  assert.doesNotMatch(deploymentScript, /set-env-vars/);
});
