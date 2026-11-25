/**
 * jlt-api-proxy: serves johnsonlegalteam.org/api/* from the jlt-php-api HTTP API (Bref on Lambda),
 * so the site's forms keep calling same-origin /api/<name>.php URLs.
 * Only the known endpoints are forwarded; everything else gets a 404 without touching the backend.
 */
const UPSTREAM = 'https://lpkyw27bm0.execute-api.us-east-1.amazonaws.com';
const ALLOWED = new Set([
  '/api/user-registration.php',
  '/api/legal-onboarding.php',
  '/api/onboarding.php',
  '/api/approve-registration.php',
  '/api/health',
]);
const FORWARD_HEADERS = ['content-type', 'accept', 'accept-language', 'user-agent', 'origin', 'referer'];

export async function handle(request, upstream = UPSTREAM) {
  const url = new URL(request.url);
  if (!ALLOWED.has(url.pathname)) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const clientIp = request.headers.get('cf-connecting-ip');
  if (clientIp) headers.set('x-forwarded-for', clientIp);
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  try {
    const response = await fetch(upstream + url.pathname + url.search, {
      method: request.method, headers, body: hasBody ? request.body : undefined, redirect: 'manual',
    });
    const out = new Response(response.body, response);
    out.headers.set('Cache-Control', 'no-store');
    return out;
  } catch (error) {
    console.error('jlt-api-proxy upstream error', error && error.stack);
    return new Response(JSON.stringify({ error: 'Service temporarily unavailable. Please call (833) 659-8378.' }), {
      status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}

export default { fetch: (request) => handle(request) };
