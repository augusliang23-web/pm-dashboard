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

test('parses a comma-separated origin list and ignores blanks and whitespace', () => {
  assert.deepEqual(
    parseAllowedOrigins(` ${PROD_PAGES} , ,${UAT_HOSTING}\n`),
    [PROD_PAGES, UAT_HOSTING]
  );
  assert.deepEqual(parseAllowedOrigins([PROD_PAGES, ' ', UAT_HOSTING]), [PROD_PAGES, UAT_HOSTING]);
  assert.deepEqual(parseAllowedOrigins(`*,${PROD_PAGES}/,${PROD_PAGES}/path,${UAT_HOSTING}`), [UAT_HOSTING]);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
  assert.deepEqual(parseAllowedOrigins(''), []);
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

test('matches origins exactly: no wildcard, prefix, path, or case-folding matches', () => {
  const allowedOrigins = `*,${UAT_HOSTING}`;
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
