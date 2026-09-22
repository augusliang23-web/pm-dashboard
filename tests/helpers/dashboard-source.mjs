import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// index.html is one environment-profiled source: every function, constant or statement that differs between
// Production and UAT is emitted as name__prod + name__uat behind a dispatcher (see the @profile markers).
// Tests assert on the source a profile actually runs, so this reproduces the Production view and the UAT view.
const repoFile = path => new URL(`../../${path}`, import.meta.url);
const readText = path => readFileSync(repoFile(path), 'utf8');
export const PROFILES = ['production', 'uat'];

const GROUP = /^\/\/ @profile-group begin (fn|win|const) (\S+)\n\/\/ @profile-variant prod\n([\s\S]*?)\n\/\/ @profile-variant uat\n([\s\S]*?)\n\/\/ @profile-dispatcher\n[^\n]*\n\/\/ @profile-group end \2$/gm;
const STATEMENT = /^\/\/ @profile-stmt begin\nif \(IS_UAT_PROFILE\) \{\n\/\/ @profile-variant uat\n([\s\S]*?)\n\} else \{\n\/\/ @profile-variant prod\n([\s\S]*?)\n\}\n\/\/ @profile-stmt end$/gm;
const LET = /^let (\w+) = IS_UAT_PROFILE \? \((.*)\) : \((.*)\);$/gm;
const ENV_BLOCK = /const PM_ENV = window\.PM_DASHBOARD_ENV;\n[\s\S]*?const DASHBOARD_BASE_COMMIT = PM_ENV\.baseCommit;\n/;

function restoreName(kind, name, text, suffix) {
  const escaped = name.replace(/\$/g, '\\$');
  if (kind === 'fn') return text.replace(new RegExp(`(function\\s+)${escaped}${suffix}(\\s*\\()`), `$1${name}$2`);
  if (kind === 'win') return text.replace(new RegExp(`^const ${escaped}${suffix} =`), `window.${name} =`);
  return text.replace(new RegExp(`^const ${escaped}${suffix} =`), `const ${name} =`);
}

function dropBlocks(text, tag) {
  const block = new RegExp(`^[ \\t]*(?:\\/\\/|\\/\\*|<!--) @${tag} begin[^\\n]*\\n[\\s\\S]*?^[ \\t]*(?:\\/\\/|\\/\\*|<!--) @${tag} end[^\\n]*\\n?`, 'gm');
  return text.replace(block, '');
}
function keepBlocks(text, tag) {
  return text.replace(new RegExp(`^[ \\t]*(?:\\/\\/|\\/\\*|<!--) @${tag} (?:begin|end)[^\\n]*\\n`, 'gm'), '');
}

function legacyEnvConstants(env, uat) {
  const config = Object.entries(env.firebaseConfig).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`).join(',\n');
  return `const IS_UAT_PROFILE = ${uat};\nconst FIREBASE_CONFIG = {\n${config}\n};\n` +
    `const DASHBOARD_RELEASE = ${JSON.stringify(env.release).replace(/"/g, "'")};\n` +
    `const DASHBOARD_BASE_COMMIT = ${JSON.stringify(env.baseCommit).replace(/"/g, "'")};\n`;
}

export function renderProfile(html, profile, env) {
  if (!PROFILES.includes(profile)) throw new Error(`Unknown dashboard profile "${profile}"`);
  const uat = profile === 'uat';
  let out = html;
  out = out.replace(GROUP, (_, kind, name, prod, uatText) => restoreName(kind, name, uat ? uatText : prod, uat ? '__uat' : '__prod'));
  out = out.replace(STATEMENT, (_, uatText, prod) => (uat ? uatText : prod));
  out = out.replace(LET, (_, name, uatInit, prodInit) => `let ${name} = ${uat ? uatInit : prodInit};`);
  out = uat ? dropBlocks(out, 'prod-only') : dropBlocks(out, 'uat-only');
  out = keepBlocks(keepBlocks(out, 'uat-only'), 'prod-only');
  out = out.replace('<script src="./env-config.js"></script>\n', '').replace(ENV_BLOCK, legacyEnvConstants(env, uat));
  out = out.replace(/ data-profile-only="(?:production|uat)"/g, '');
  if (uat) {
    out = out.replace(/ vip-hidden(?= |")/g, '').replace('<span class="hdr-version">v2.1</span>', `<span class="hdr-version">${env.release}</span>`);
    out = out.replace(/<option value="business-product" data-uat-label="([^"]*)">[^<]*<\/option>/g, '<option value="business-product">$1</option>')
      .replace('<style id="uatButtonSystem" media="not all">', '<style id="uatButtonSystem">');
  } else {
    out = out.replace(/ executive-hidden(?= |")/g, '').replace(/ data-uat-label="[^"]*"/g, '');
  }
  return out;
}

export function environmentFor(profile) {
  return JSON.parse(readText(profile === 'uat' ? 'env/uat.json' : 'env/prod.json'));
}
export function dashboardSource(profile = 'production') {
  return renderProfile(readText('index.html'), profile, environmentFor(profile));
}
export function rawDashboardSource() { return readText('index.html'); }

// ---- function inventory (used by the Production-invariant test) ----
const FUNC_START = /^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|^window\.([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*\{\s*$|^const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>\s*\{\s*$/;
export function functionInventory(text) {
  const lines = text.split('\n'); const found = {};
  for (let i = 0; i < lines.length;) {
    const m = FUNC_START.exec(lines[i]);
    if (!m) { i += 1; continue; }
    const name = m[1] || m[2] || m[3]; let j = i + 1;
    while (j < lines.length && !/^\}\)?;?\s*$/.test(lines[j])) j += 1;
    found[name] = createHash('sha256').update(lines.slice(i, j + 1).join('\n')).digest('hex');
    i = j + 1;
  }
  return found;
}
export const dashboardSourceAsync = async profile => dashboardSource(profile);
