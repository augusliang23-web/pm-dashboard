// Guarded, contract-scoped Cloud Functions release. See scripts/functions-release-guard.mjs for the rules and the
// stated limitation (it cannot stop a direct Firebase CLI call). Dry-run is the default; --execute starts the CLI.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFunctionsDeploy } from './functions-release-guard.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runFunctionsDeploy(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
