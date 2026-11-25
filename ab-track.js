/* A/B/C/D sandbox tracker. Every call-to-action interaction counts as a lead (win).
 *
 * Sinks (all optional, used if present):
 *   - window.dataLayer / window.gtag  (Google Analytics / Tag Manager)
 *   - window.AB_ENDPOINT              (URL that receives a JSON beacon)
 *   - localStorage "ab_events"        (last 200 events, for sandbox review in DevTools)
 */
(function () {
  'use strict';
  var variantMeta = document.querySelector('meta[name="ab-variant"]');
  var pageMeta = document.querySelector('meta[name="ab-page"]');
  var variant = variantMeta ? variantMeta.content : 'unknown';
  var page = pageMeta ? pageMeta.content : location.pathname;
  var device = window.matchMedia && window.matchMedia('(max-width: 767.98px)').matches ? 'mobile' : 'desktop';

  // UI controls that are not calls to action.
  var IGNORE = '.accordion-button, .carousel-control-prev, .carousel-control-next, .navbar-toggler, .search-btn, .ab-badge';
  var CTA = 'a.btn, button.btn, [data-cta], a[href^="tel:"], a[href^="mailto:"]';

  function classify(el) {
    var href = (el.getAttribute && el.getAttribute('href')) || '';
    if (/^tel:/i.test(href)) return 'call';
    if (/^mailto:/i.test(href)) return 'email';
    if (/calendly\.com/i.test(href)) return 'schedule';
    if (/(^|\/)contact(\.html)?([?#]|$)/i.test(href)) return 'contact';
    if (el.closest && el.closest('[id*="chat"], [class*="chat"]')) return 'chat';
    return 'navigate';
  }

  function emit(name, detail) {
    var evt = { event: name, variant: variant, device: device, page: page, ts: new Date().toISOString() };
    for (var k in detail) { if (Object.prototype.hasOwnProperty.call(detail, k)) evt[k] = detail[k]; }
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(evt);
      if (typeof window.gtag === 'function') window.gtag('event', name, evt);
    } catch (e) { console.warn('ab-track: analytics sink failed', e); }
    try {
      if (window.AB_ENDPOINT && navigator.sendBeacon) {
        navigator.sendBeacon(window.AB_ENDPOINT, new Blob([JSON.stringify(evt)], { type: 'application/json' }));
      }
    } catch (e) { console.warn('ab-track: beacon failed', e); }
    try {
      var log = JSON.parse(localStorage.getItem('ab_events') || '[]');
      log.push(evt);
      localStorage.setItem('ab_events', JSON.stringify(log.slice(-200)));
    } catch (e) { /* storage unavailable (private mode); sandbox log is best-effort */ }
  }

  emit('ab_view', { is_lead: false });

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest(CTA) : null;
    if (!el || el.closest(IGNORE)) return;
    emit('ab_cta_click', {
      is_lead: true,
      cta_type: classify(el),
      cta_id: el.getAttribute('data-cta') || '',
      cta_label: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    });
  }, true);

  document.addEventListener('submit', function (e) {
    emit('ab_cta_click', { is_lead: true, cta_type: 'form_submit', cta_id: (e.target && e.target.id) || '', cta_label: 'form' });
  }, true);
})();
