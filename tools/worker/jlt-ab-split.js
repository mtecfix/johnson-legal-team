/**
 * jlt-ab-split: landing-page variant split for johnsonlegalteam.org.
 *
 * Runs only on the six test pages (exact Worker routes). Rules, in order:
 *   1. ?v=a|b|c|d            -> that variant, no cookie (QA preview; works in every mode)
 *   2. SPLIT_MODE != "live"  -> original page for everyone
 *   3. Phones                -> D for ad visitors and returning ad visitors (100%)
 *   4. Desktop/tablet        -> returning ad visitors keep their cookie variant; new ad visitors get
 *                               A 40% / B 40% / C 20%
 *   5. Everyone else (organic, no cookie) -> the original page
 * Assignment is random (never based on whether the client is a crawler); device type only selects the
 * mobile design. A failed variant fetch falls back to the original page. Variant pages are noindex with a
 * canonical link to the original.
 */
const TEST_PAGES = new Set([
  'expungements', 'misdemeanors', 'personal-injury',
  'probate-estate-planning', 'traffic-tickets', 'practice-areas',
]);
const VARIANTS = ['a', 'b', 'c', 'd'];
const DESKTOP_WEIGHTS = [['a', 40], ['b', 40], ['c', 20]];
const COOKIE_NAME = 'jlt_ab';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const AD_CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid'];
const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'paid-search']);
// Phones only; tablets (iPad, Android without "Mobile") get the desktop experience.
const MOBILE_UA = /Android.+Mobile|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile|Mobile Safari/i;

export function isAdClick(url) {
  if (AD_CLICK_PARAMS.some((name) => url.searchParams.has(name))) return true;
  return PAID_MEDIUMS.has((url.searchParams.get('utm_medium') || '').toLowerCase());
}

export function isMobile(headers) {
  const hint = headers.get('Sec-CH-UA-Mobile');
  if (hint === '?1') return true;
  if (hint === '?0') return false;
  return MOBILE_UA.test(headers.get('User-Agent') || '');
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** Uniform integer in [0, 100) via rejection sampling (no modulo bias). */
function randomPercent(randomByte) {
  let byte;
  do { byte = randomByte(); } while (byte >= 200);
  return byte % 100;
}

export function pickDesktopVariant(randomByte) {
  let roll = randomPercent(randomByte);
  for (const [variant, weight] of DESKTOP_WEIGHTS) {
    if (roll < weight) return variant;
    roll -= weight;
  }
  return DESKTOP_WEIGHTS[0][0];
}

/** Returns { variant: 'a'|'b'|'c'|'d'|null (original), setCookie, reason }. */
export function decide(url, headers, mode, randomByte) {
  const forced = (url.searchParams.get('v') || '').toLowerCase();
  if (VARIANTS.includes(forced)) return { variant: forced, setCookie: false, reason: 'preview' };
  if (mode !== 'live') return { variant: null, setCookie: false, reason: 'preview-mode' };

  const cookie = readCookie(headers.get('Cookie'), COOKIE_NAME);
  const hasCookie = VARIANTS.includes(cookie);
  const adClick = isAdClick(url);

  if (isMobile(headers)) {
    if (cookie === 'd') return { variant: 'd', setCookie: false, reason: 'returning' };
    if (adClick || hasCookie) return { variant: 'd', setCookie: true, reason: adClick ? 'ad' : 'returning-device-change' };
    return { variant: null, setCookie: false, reason: 'organic' };
  }
  if (hasCookie && cookie !== 'd') return { variant: cookie, setCookie: false, reason: 'returning' };
  if (adClick || cookie === 'd') {
    return { variant: pickDesktopVariant(randomByte), setCookie: true, reason: adClick ? 'ad' : 'returning-device-change' };
  }
  return { variant: null, setCookie: false, reason: 'organic' };
}

function decorate(upstream, label, reason, cookieVariant) {
  const headers = new Headers(upstream.headers);
  headers.set('X-AB-Variant', label);
  headers.set('X-AB-Reason', reason);
  // Same URL can return different pages per visitor, so browsers and shared caches must not reuse it.
  headers.set('Cache-Control', 'private, no-cache');
  headers.append('Vary', 'Cookie, User-Agent, Sec-CH-UA-Mobile');
  if (cookieVariant) {
    headers.append('Set-Cookie',
      `${COOKIE_NAME}=${cookieVariant}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Secure; SameSite=Lax`);
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

const cryptoByte = () => crypto.getRandomValues(new Uint8Array(1))[0];

export async function handle(request, env, randomByte = cryptoByte) {
  const url = new URL(request.url);
  const page = url.pathname.replace(/^\/+/, '').replace(/\.html$/, '');
  if ((request.method !== 'GET' && request.method !== 'HEAD') || !TEST_PAGES.has(page)) {
    return fetch(request);
  }
  const { variant, setCookie, reason } = decide(url, request.headers, (env && env.SPLIT_MODE) || 'preview', randomByte);
  // Same-zone subrequests go to the origin (S3) and do not re-run this Worker.
  const originalUrl = new URL(`/${page}.html`, url.origin);
  if (variant) {
    const upstream = await fetch(new URL(`/${page}-${variant}.html`, url.origin), { method: request.method });
    if (upstream.ok) return decorate(upstream, variant.toUpperCase(), reason, setCookie ? variant : null);
    console.warn(`jlt-ab-split: variant ${page}-${variant} returned ${upstream.status}; serving original`);
    return decorate(await fetch(originalUrl, { method: request.method }), 'original-fallback', reason, null);
  }
  return decorate(await fetch(originalUrl, { method: request.method }), 'original', reason, null);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      // Never take the page down because of the split: pass the request straight to the origin.
      console.error('jlt-ab-split error; passing through', error && error.stack);
      return fetch(request);
    }
  },
};
