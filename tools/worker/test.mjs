// Offline tests for jlt-ab-split. The origin is mocked so results are deterministic.
import worker, { handle, decide, isAdClick, isMobile, pickDesktopVariant } from './jlt-ab-split.js';

const ORIGIN = 'https://johnsonlegalteam.org';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const PAGES = ['expungements', 'misdemeanors', 'personal-injury', 'probate-estate-planning', 'traffic-tickets', 'practice-areas'];

let missing = new Set();
const fetched = [];
globalThis.fetch = async (input) => {
  const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  fetched.push(u.pathname);
  if (missing.has(u.pathname)) return new Response('not found', { status: 404 });
  return new Response(`<html>${u.pathname}</html>`, { status: 200, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=300' } });
};

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) failures++; };
const req = (path, { ua = DESKTOP, cookie, method = 'GET', hints = {} } = {}) =>
  new Request(ORIGIN + path, { method, headers: { 'User-Agent': ua, ...(cookie ? { Cookie: cookie } : {}), ...hints } });
const LIVE = { SPLIT_MODE: 'live' };
const PREVIEW = { SPLIT_MODE: 'preview' };
const body = async (r) => r.text();

// Preview mode
let r = await handle(req('/expungements?gclid=x'), PREVIEW);
check('preview: ad click still gets original', r.headers.get('x-ab-variant') === 'original' && (await body(r)).includes('/expungements.html') && !r.headers.get('set-cookie'));
r = await handle(req('/expungements?v=c'), PREVIEW);
check('preview: ?v=c serves C, no cookie', r.headers.get('x-ab-variant') === 'C' && (await body(r)).includes('/expungements-c.html') && !r.headers.get('set-cookie'));
r = await handle(req('/expungements'), {});
check('missing SPLIT_MODE defaults to preview', r.headers.get('x-ab-reason') === 'preview-mode');

// Live: organic
r = await handle(req('/expungements'), LIVE);
check('live organic desktop -> original, no cookie', r.headers.get('x-ab-variant') === 'original' && !r.headers.get('set-cookie'));
r = await handle(req('/expungements', { ua: IPHONE }), LIVE);
check('live organic phone -> original', r.headers.get('x-ab-variant') === 'original');
r = await handle(req('/expungements?utm_medium=email'), LIVE);
check('utm_medium=email is not an ad click', r.headers.get('x-ab-variant') === 'original');

// Live: desktop ad distribution
const tally = { A: 0, B: 0, C: 0, D: 0 };
for (let i = 0; i < 6000; i++) { const x = await handle(req('/expungements?gclid=abc'), LIVE); tally[x.headers.get('x-ab-variant')]++; await body(x); }
const pct = (n) => (100 * n / 6000).toFixed(1);
check('desktop ad split ~40/40/20, never D', tally.D === 0 && Math.abs(tally.A / 6000 - 0.4) < 0.03 && Math.abs(tally.B / 6000 - 0.4) < 0.03 && Math.abs(tally.C / 6000 - 0.2) < 0.03, `A ${pct(tally.A)}% B ${pct(tally.B)}% C ${pct(tally.C)}%`);
check('pickDesktopVariant boundaries', pickDesktopVariant(() => 0) === 'a' && pickDesktopVariant(() => 39) === 'a' && pickDesktopVariant(() => 40) === 'b' && pickDesktopVariant(() => 79) === 'b' && pickDesktopVariant(() => 80) === 'c' && pickDesktopVariant(() => 99) === 'c' && pickDesktopVariant(() => 199) === 'c');
let calls = 0; const seq = [250, 210, 5];
check('rejection sampling skips bytes >= 200', pickDesktopVariant(() => seq[calls++]) === 'a' && calls === 3);
for (const p of ['gbraid', 'wbraid']) { r = await handle(req(`/expungements?${p}=1`), LIVE); check(`${p} counts as ad click`, ['A', 'B', 'C'].includes(r.headers.get('x-ab-variant'))); }
r = await handle(req('/expungements?utm_medium=CPC'), LIVE);
check('utm_medium=CPC counts as ad click', ['A', 'B', 'C'].includes(r.headers.get('x-ab-variant')) && /jlt_ab=[abc];/.test(r.headers.get('set-cookie') || ''));

// Live: phones
let allD = true;
for (const ua of [IPHONE, ANDROID]) for (let i = 0; i < 200; i++) { const x = await handle(req('/personal-injury?gclid=1', { ua }), LIVE); allD = allD && x.headers.get('x-ab-variant') === 'D' && /jlt_ab=d;/.test(x.headers.get('set-cookie') || ''); await body(x); }
check('phone ad clicks -> D 100% with cookie', allD);
r = await handle(req('/personal-injury?gclid=1', { ua: IPAD }), LIVE);
check('iPad treated as desktop', ['A', 'B', 'C'].includes(r.headers.get('x-ab-variant')));
r = await handle(req('/personal-injury?gclid=1', { ua: DESKTOP, hints: { 'Sec-CH-UA-Mobile': '?1' } }), LIVE);
check('client hint ?1 -> mobile D', r.headers.get('x-ab-variant') === 'D');
r = await handle(req('/personal-injury?gclid=1', { ua: IPHONE, hints: { 'Sec-CH-UA-Mobile': '?0' } }), LIVE);
check('client hint ?0 overrides phone UA', r.headers.get('x-ab-variant') !== 'D');

// Live: returning visitors
r = await handle(req('/misdemeanors', { cookie: 'jlt_ab=b' }), LIVE);
check('returning desktop keeps B, no new cookie', r.headers.get('x-ab-variant') === 'B' && !r.headers.get('set-cookie'));
r = await handle(req('/misdemeanors', { ua: IPHONE, cookie: 'jlt_ab=d' }), LIVE);
check('returning phone keeps D', r.headers.get('x-ab-variant') === 'D' && !r.headers.get('set-cookie'));
r = await handle(req('/misdemeanors', { ua: IPHONE, cookie: 'jlt_ab=a' }), LIVE);
check('phone with desktop cookie -> D, cookie updated', r.headers.get('x-ab-variant') === 'D' && /jlt_ab=d;/.test(r.headers.get('set-cookie') || ''));
r = await handle(req('/misdemeanors', { cookie: 'jlt_ab=d' }), LIVE);
check('desktop with d cookie -> reassigned A/B/C', ['A', 'B', 'C'].includes(r.headers.get('x-ab-variant')) && /jlt_ab=[abc];/.test(r.headers.get('set-cookie') || ''));
r = await handle(req('/misdemeanors', { cookie: 'jlt_ab=zzz' }), LIVE);
check('invalid cookie, no ad -> original', r.headers.get('x-ab-variant') === 'original');

// Every page x variant, both URL forms
let pageOk = true;
for (const p of PAGES) for (const v of ['a', 'b', 'c', 'd']) for (const form of [`/${p}`, `/${p}.html`]) {
  const x = await handle(req(`${form}?v=${v}`), LIVE); const b = await body(x);
  pageOk = pageOk && x.status === 200 && x.headers.get('x-ab-variant') === v.toUpperCase() && b.includes(`/${p}-${v}.html`);
}
check('all 6 pages x 4 variants x 2 URL forms', pageOk);

// Headers, fallback, passthrough
r = await handle(req('/traffic-tickets?gclid=1'), LIVE);
check('cache + vary headers', r.headers.get('cache-control') === 'private, no-cache' && /Cookie/.test(r.headers.get('vary')) && /User-Agent/.test(r.headers.get('vary')));
check('cookie is Secure, SameSite=Lax, 30 days', /Secure/.test(r.headers.get('set-cookie')) && /SameSite=Lax/.test(r.headers.get('set-cookie')) && /Max-Age=2592000/.test(r.headers.get('set-cookie')));
missing = new Set(['/traffic-tickets-c.html']);
r = await handle(req('/traffic-tickets?v=c'), LIVE);
check('missing variant falls back to original', r.status === 200 && r.headers.get('x-ab-variant') === 'original-fallback' && (await body(r)).includes('/traffic-tickets.html'));
missing = new Set();
fetched.length = 0;
r = await handle(req('/about'), LIVE);
check('non-test path passes through untouched', !r.headers.get('x-ab-variant') && fetched[0] === '/about');
fetched.length = 0;
r = await handle(req('/expungements', { method: 'POST' }), LIVE);
check('non-GET passes through untouched', !r.headers.get('x-ab-variant') && fetched[0] === '/expungements');
const realFetch = globalThis.fetch; let threw = false;
globalThis.fetch = async (input) => { if (!threw) { threw = true; throw new Error('boom'); } return realFetch(input); };
r = await worker.fetch(req('/expungements?v=b'), LIVE);
check('exception -> passthrough to origin', r.status === 200 && !r.headers.get('x-ab-variant'));
globalThis.fetch = realFetch;

console.log(failures ? `${failures} FAILURES` : 'ALL TESTS PASSED');
process.exit(failures ? 1 : 0);
