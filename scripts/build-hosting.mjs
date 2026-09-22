import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectHostingAssets } from './hosting-assets.mjs';
import { loadHostingEnv } from './hosting-env.mjs';
import { renderEnvConfig } from './env-config.mjs';

// One environment-neutral source (index.html, professional-pdf-config.js, ...) is shared by every environment;
// env-config.js is the only file the build regenerates per target, from env/<name>.json. Everything else is
// copied byte-for-byte, so there is no source-level branch that picks an environment.
function containsRoot(outDir, rootDir) {
  const distance = relative(resolve(outDir), resolve(rootDir));
  return distance === '' || !distance.startsWith('..');
}

async function assertNoCrossEnvironmentLeak(outDir, files, env) {
  const otherProjectIds = Object.entries({ prod: 'project-manager-dashboar-a067f', uat: 'pm-dashboard-uat-20260820-a7f3' })
    .filter(([name]) => name !== env.environment)
    .map(([, projectId]) => projectId);
  for (const file of files) {
    const text = await readFile(join(outDir, file), 'utf8').catch(() => '');
    for (const projectId of otherProjectIds) {
      if (text.includes(projectId)) {
        throw new Error(`${file} in the ${env.environment} build names another environment's Firebase project "${projectId}".`);
      }
    }
  }
}

export async function buildHosting({ rootDir, outDir, env, log = () => {} }) {
  if (containsRoot(outDir, rootDir)) {
    throw new Error('Refusing to rebuild an output directory that contains the repository root.');
  }
  const files = await collectHostingAssets(rootDir);
  if (!files.includes('env-config.js')) {
    throw new Error('index.html must load env-config.js so the hosting build can inject the target environment.');
  }

  await rm(outDir, { recursive: true, force: true });
  for (const file of files) {
    await mkdir(dirname(join(outDir, file)), { recursive: true });
    await copyFile(join(rootDir, file), join(outDir, file));
  }
  // Overwrite the copied (Production-default) env-config.js with this target's rendering. This is the only
  // environment-specific write the build performs.
  await writeFile(join(outDir, 'env-config.js'), renderEnvConfig(env));
  await assertNoCrossEnvironmentLeak(outDir, files, env);

  if (!env.pdfReleaseReady) {
    log(`NOT READY FOR RELEASE: ${env.environment} has no PDF Cloud Run service configured (env/${env.environment}.json pdfServiceUrl is null). ` +
      'The dashboard will build and serve, but PDF export will refuse cleanly until a dedicated service is deployed and env/' +
      `${env.environment}.json is updated. This build does not fall back to another environment's PDF service.`);
  }

  return { files, projectId: env.firebaseProjectId, pdfReleaseReady: env.pdfReleaseReady };
}

async function main(argv) {
  if (argv.length !== 2 || argv[0] !== '--env') {
    throw new Error('Usage: node scripts/build-hosting.mjs --env <environment>');
  }
  const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const env = await loadHostingEnv(rootDir, argv[1]);
  const { files, projectId, pdfReleaseReady } = await buildHosting({ rootDir, outDir: join(rootDir, 'dist'), env, log: console.log });
  console.log(`Built dist/ for ${env.environment} (${projectId}): ${files.length} files. PDF release ready: ${pdfReleaseReady}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
