// Packaging validation only; this file does not calculate business metrics.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function verifyDeliveryTrendsPackage({ srcDir, canonicalPath } = {}) {
  const sourcePath = join(srcDir, 'generated/delivery-trends.mjs');
  const bytes = await readFile(sourcePath);
  const hash = (await readFile(join(srcDir, 'generated/delivery-trends.sha256'), 'utf8')).trim();
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('PDF metrics package checksum mismatch.');
  if (canonicalPath && !(await readFile(canonicalPath)).equals(bytes)) throw new Error('PDF metrics package differs from authoritative shared source.');
  const module = await import(pathToFileURL(sourcePath).href);
  if (typeof module.calculateDeliveryTrends !== 'function'
    || module.calculateDeliveryTrends({}).contractVersion !== 'delivery-trends/v1') throw new Error('PDF metrics import contract failed.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyDeliveryTrendsPackage({ srcDir: fileURLToPath(new URL('.', import.meta.url)) });
}
