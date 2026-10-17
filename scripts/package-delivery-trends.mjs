import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function syncDeliveryTrendsPackage({ rootDir, check = false }) {
  const source = await readFile(join(rootDir, 'shared/delivery-trends.mjs'));
  const directory = join(rootDir, 'pdf-service/src/generated');
  const target = join(directory, 'delivery-trends.mjs');
  const hashPath = join(directory, 'delivery-trends.sha256');
  const hash = createHash('sha256').update(source).digest('hex') + '\n';
  if (check) {
    const [copy, storedHash] = await Promise.all([readFile(target), readFile(hashPath, 'utf8')]);
    if (!copy.equals(source) || storedHash !== hash) throw new Error('PDF metrics package drift: run node scripts/package-delivery-trends.mjs and commit generated files.');
  } else {
    await mkdir(directory, { recursive: true });
    await writeFile(target, source);
    await writeFile(hashPath, hash);
  }
  return { sha256: hash.trim() };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--check')) throw new Error('Usage: package-delivery-trends.mjs [--check]');
  await syncDeliveryTrendsPackage({ rootDir: fileURLToPath(new URL('..', import.meta.url)), check: args[0] === '--check' });
}
