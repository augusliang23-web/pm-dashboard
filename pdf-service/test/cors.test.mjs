import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCors, handlePreflight, parseAllowedOrigins } from '../src/cors.js';

function responseStub() {
  return {
    headers: {},
    statusCode: null,
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(statusCode) { this.statusCode = statusCode; return this; },
    end() { this.ended = true; }
  };
}

test('allows a preflight request only from the configured dashboard origin', () => {
  const response = responseStub();
  const handled = handlePreflight(
    { method: 'OPTIONS', headers: { origin: 'https://augusliang23-web.github.io' } },
    response,
    'https://augusliang23-web.github.io'
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['Access-Control-Allow-Origin'], 'https://augusliang23-web.github.io');
  assert.equal(response.headers['Access-Control-Allow-Headers'], 'Authorization, Content-Type');
});

test('rejects CORS requests from an unconfigured origin', () => {
  const response = responseStub();
  const allowed = applyCors(
    { headers: { origin: 'https://untrusted.example' } },
    response,
    'https://augusliang23-web.github.io'
  );

  assert.equal(allowed, false);
  assert.deepEqual(response.headers, {});
});

const PROD_PAGES = 'https://augusliang23-web.github.io';
const PROD_HOSTING = 'https://project-manager-dashboar-a067f.web.app';
const UAT_HOSTING = 'https://pm-dashboard-uat-20260820-a7f3.web.app';

test('parses a comma-separated origin list and ignores blank segments (not malformed entries)', () => {
  assert.deepEqual(
    parseAllowedOrigins(` ${PROD_PAGES} , ,${UAT_HOSTING}\n`),
    [PROD_PAGES, UAT_HOSTING]
  );
  assert.deepEqual(parseAllowedOrigins([PROD_PAGES, ' ', UAT_HOSTING]), [PROD_PAGES, UAT_HOSTING]);
  // A blank segment carries no attempted origin (a stray/trailing/doubled comma), so it stays silently ignored.
  // This is different from MEDIUM #3: a *non-blank* malformed entry, tested below, must fail closed instead.
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(parseAllowedOrigins(''), []);
  assert.deepEqual(parseAllowedOrigins(' , , '), []);
});

// MEDIUM #3 (Control Plane remediation on top of fcca7b6): parseAllowedOrigins used to silently filter out any
// entry that did not look like a bare origin, so a malformed entry mixed in with otherwise-correct ones never
// surfaced as a configuration error -- as long as what remained still matched the expected set. It must instead
// fail configuration/startup closed. Each case below pairs one malformed entry with an otherwise-valid list.
test('fails closed (throws) on a malformed origin entry instead of silently dropping it', () => {
  const malformed = [
    `*,${UAT_HOSTING}`, // wildcard
    `${PROD_PAGES}/,${UAT_HOSTING}`, // trailing slash / path
    `${PROD_PAGES}/path,${UAT_HOSTING}`, // path
    `${PROD_PAGES}?x=1,${UAT_HOSTING}`, // query string
    `${PROD_PAGES}#frag,${UAT_HOSTING}`, // fragment
    `https://user:pass@augusliang23-web.github.io,${UAT_HOSTING}`, // embedded credentials
    'ftp://augusliang23-web.github.io', // unsupported protocol
    'javascript:alert(1)', // unsupported protocol / not an origin at all
    'not a url', // malformed URL
    `${UAT_HOSTING}:443,${PROD_PAGES}`, // non-canonical explicit default port (https default is 443)
    `HTTPS://${UAT_HOSTING.slice('https://'.length).toUpperCase()},${PROD_PAGES}`, // non-canonical casing
  ];
  for (const value of malformed) {
    assert.throws(() => parseAllowedOrigins(value), /ALLOWED_ORIGIN entry/, value);
  }
});

test('a single malformed entry invalidates the whole configured list, not just that entry', () => {
  // Before the fix, this returned [UAT_HOSTING] -- silently narrowing the allowlist rather than surfacing that
  // "*" is not a valid ALLOWED_ORIGIN entry.
  assert.throws(() => parseAllowedOrigins(`*,${UAT_HOSTING}`), /wildcard/);
});

test('accepts every exact, canonical origin form used by the real registered targets', () => {
  for (const value of [PROD_PAGES, PROD_HOSTING, UAT_HOSTING, 'http://localhost:5173', 'https://example.com:8443']) {
    assert.deepEqual(parseAllowedOrigins(value), [value]);
  }
  assert.deepEqual(
    parseAllowedOrigins(`${PROD_PAGES},${PROD_HOSTING},${UAT_HOSTING}`),
    [PROD_PAGES, PROD_HOSTING, UAT_HOSTING]
  );
});

test('echoes back only the matching origin when several origins are allowed', () => {
  const allowedOrigins = `${PROD_PAGES},${PROD_HOSTING},${UAT_HOSTING}`;
  for (const origin of [PROD_PAGES, PROD_HOSTING, UAT_HOSTING]) {
    const response = responseStub();
    assert.equal(applyCors({ headers: { origin } }, response, allowedOrigins), true);
    assert.equal(response.headers['Access-Control-Allow-Origin'], origin);
    assert.equal(response.headers.Vary, 'Origin');
  }
});

test('multi-origin preflight answers 204 for a listed origin and 403 for others', () => {
  const allowedOrigins = `${PROD_PAGES},${UAT_HOSTING}`;
  const ok = responseStub();
  assert.equal(handlePreflight({ method: 'OPTIONS', headers: { origin: UAT_HOSTING } }, ok, allowedOrigins), true);
  assert.equal(ok.statusCode, 204);
  assert.equal(ok.headers['Access-Control-Allow-Origin'], UAT_HOSTING);

  const denied = responseStub();
  assert.equal(handlePreflight({ method: 'OPTIONS', headers: { origin: PROD_HOSTING } }, denied, allowedOrigins), true);
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(denied.headers, {});
});

test('matches the configured origin exactly: no wildcard, prefix, path, or case-folding matches', () => {
  // The configured allowlist itself must be valid (a "*" here is a MEDIUM #3 configuration error, covered above);
  // this test is about the separate, unaffected concern of matching an incoming *request* Origin header, which is
  // never itself run through origin validation, only compared for exact string equality against the parsed list.
  const allowedOrigins = UAT_HOSTING;
  for (const origin of [
    '*',
    `${UAT_HOSTING}.evil.example`,
    `${UAT_HOSTING}/`,
    `${UAT_HOSTING}/path`,
    UAT_HOSTING.toUpperCase(),
    'http://pm-dashboard-uat-20260820-a7f3.web.app'
  ]) {
    const response = responseStub();
    assert.equal(applyCors({ headers: { origin } }, response, allowedOrigins), false, origin);
    assert.deepEqual(response.headers, {}, origin);
  }
});

test('fails closed when no origins are configured or the request has no Origin header', () => {
  for (const configured of [undefined, '', ' , ']) {
    const response = responseStub();
    assert.equal(applyCors({ headers: { origin: PROD_PAGES } }, response, configured), false);
    assert.deepEqual(response.headers, {});
  }
  const noOrigin = responseStub();
  assert.equal(applyCors({ headers: {} }, noOrigin, undefined), false);
  assert.equal(applyCors({ headers: {} }, noOrigin, PROD_PAGES), false);
});
