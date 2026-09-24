// ALLOWED_ORIGIN accepts one origin or a comma-separated list. Each entry must be a bare, canonical
// scheme://host[:port] origin and is compared to the request Origin exactly; wildcards, paths, query strings,
// fragments, embedded credentials, non-http(s) schemes, and non-canonical forms (default ports, mixed case, a
// trailing slash) are all configuration errors, never silently-matched or silently-dropped variants.
//
// A blank segment (an empty string, or one that is only whitespace -- the result of a stray leading/trailing/
// doubled comma in the list) is not a malformed *entry*; it carries no attempted origin, so it is ignored the same
// way a trailing comma is ignored in any comma-separated list. Everything else that remains must parse as a valid
// origin or the whole configuration is rejected: a malformed entry means the deployer's intent is unknown, and
// guessing by dropping it could silently narrow -- or, if it was meant to remove a stale origin, silently widen --
// the effective allowlist. See MEDIUM #3 (Control Plane remediation on top of fcca7b6): the previous
// implementation filtered non-matching entries out of the list instead of failing configuration/startup, so a
// malformed entry ("*", a path, an unsupported scheme, ...) elsewhere in ALLOWED_ORIGIN never surfaced as an error
// as long as the remaining valid entries happened to still be exactly the registered set.
function validateOrigin(rawEntry) {
  const entry = String(rawEntry).trim();
  if (entry.includes('*')) {
    throw new Error(`ALLOWED_ORIGIN entry must not contain a wildcard: ${JSON.stringify(entry)}.`);
  }
  let url;
  try {
    url = new URL(entry);
  } catch {
    throw new Error(`ALLOWED_ORIGIN entry is not a valid URL: ${JSON.stringify(entry)}.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ALLOWED_ORIGIN entry must use http:// or https://, not "${url.protocol}": ${JSON.stringify(entry)}.`);
  }
  // A canonical bare origin round-trips exactly through the URL parser's own serialization. Anything that does
  // not -- a path (including a bare trailing slash), a query string, a fragment, embedded credentials, an
  // explicit default port, or non-canonical host/scheme casing -- fails this equality and is rejected.
  if (url.origin !== entry) {
    throw new Error(
      `ALLOWED_ORIGIN entry must be a canonical bare origin (scheme://host[:port], no path, query, fragment, ` +
      `credentials, default port, or non-canonical casing): ${JSON.stringify(entry)}.`
    );
  }
  return entry;
}

export function parseAllowedOrigins(value) {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(',');
  const attempted = entries.map(entry => String(entry).trim()).filter(entry => entry !== '');
  return attempted.map(validateOrigin);
}

function matchAllowedOrigin(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin) return null;
  return parseAllowedOrigins(allowedOrigins).includes(origin) ? origin : null;
}

export function applyCors(request, response, allowedOrigins) {
  const origin = matchAllowedOrigin(request, allowedOrigins);
  if (!origin) return false;

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return true;
}

export function handlePreflight(request, response, allowedOrigins) {
  if (request.method !== 'OPTIONS') return false;
  if (!applyCors(request, response, allowedOrigins)) {
    response.writeHead(403).end();
    return true;
  }
  response.writeHead(204).end();
  return true;
}
