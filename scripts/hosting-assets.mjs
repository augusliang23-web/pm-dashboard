import { readFile, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';

// The published files are the local reference closure of index.html: every
// script, stylesheet, or ES module it loads, followed transitively. Nothing
// else in the repository can reach the hosting directory.
const IMPORT_PATTERN = /\b(?:from|import)\s*\(?\s*(["'])(\.{1,2}\/[^"']*)\1/g;
const HTML_ATTRIBUTE_PATTERN = /\b(?:src|href)\s*=\s*(["'])([^"']+)\1/g;
const UNSUPPORTED_PATTERNS = [
  /\bfetch\s*\(\s*["'`]\.{0,2}\//,
  /\bnew\s+URL\s*\(\s*["'`]\.{1,2}\//,
  /\bnew\s+(?:Shared)?Worker\s*\(\s*["'`]\.{0,2}\//,
  /\bimportScripts\s*\(\s*["'`]\.{0,2}\//,
  /\burl\(\s*["']?\.{0,2}\//
];

function isLocalHtmlReference(value) {
  return !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value) && !/[${}\s]/.test(value);
}

function stripQuery(specifier) {
  return specifier.split(/[?#]/)[0];
}

function findReferences(file, text) {
  if (file.endsWith('.html')) {
    return [...text.matchAll(HTML_ATTRIBUTE_PATTERN)].map(match => match[2]).filter(isLocalHtmlReference)
      .concat([...text.matchAll(IMPORT_PATTERN)].map(match => match[2]));
  }
  return [...text.matchAll(IMPORT_PATTERN)].map(match => match[2]);
}

function isScannable(file) {
  return /\.(?:html|m?js)$/.test(file);
}

export async function collectHostingAssets(rootDir, entry = 'index.html') {
  const assets = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (assets.has(file)) continue;
    assets.add(file);
    if (!isScannable(file)) continue;

    const text = await readFile(join(rootDir, file), 'utf8');
    for (const pattern of UNSUPPORTED_PATTERNS) {
      if (pattern.test(text)) {
        throw new Error(`Unsupported asset reference in ${file}: ${pattern}. Use a static import or a script/link tag so the hosting build can follow it.`);
      }
    }
    for (const reference of findReferences(file, text)) {
      const target = posix.normalize(posix.join(posix.dirname(file), stripQuery(reference)));
      if (target.startsWith('../') || target === '..' || posix.isAbsolute(target)) {
        throw new Error(`${file} references "${reference}" outside the repository.`);
      }
      const found = await stat(join(rootDir, target)).catch(() => null);
      if (!found?.isFile()) {
        throw new Error(`Missing hosting asset "${target}" referenced from ${file}.`);
      }
      queue.push(target);
    }
  }
  return [...assets].sort();
}
