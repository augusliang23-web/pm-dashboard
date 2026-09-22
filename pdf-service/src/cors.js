// ALLOWED_ORIGIN accepts one origin or a comma-separated list. Each entry must
// be a bare scheme://host[:port] origin and is compared to the request Origin
// exactly; wildcards, paths, and trailing slashes are dropped, never matched.
const ORIGIN_SHAPE = /^https?:\/\/[^/*\s]+$/;

export function parseAllowedOrigins(value) {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(',');
  return entries.map(entry => String(entry).trim()).filter(entry => ORIGIN_SHAPE.test(entry));
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
