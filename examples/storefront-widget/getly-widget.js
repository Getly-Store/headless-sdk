/**
 * Getly storefront widget — dependency-free vanilla JS embed.
 *
 * Usage:
 *   <div data-getly-store="your-store-slug" data-locale="en" data-currency="USD" data-limit="8"></div>
 *   <script src="getly-widget.js"></script>
 *
 * Data attributes:
 *   data-getly-store   (required) store slug — getly.store/store/<slug>
 *   data-locale        BCP-47 locale for number formatting + localized names ("en", "ru", "de"). Default "en".
 *   data-currency      display currency code for Intl.NumberFormat. Default: the currency
 *                      the API returns (USD). NOTE: this changes FORMATTING only — the
 *                      widget does NOT convert amounts. Leave it unset unless you know
 *                      why you're overriding it.
 *   data-limit         products to show, 1–100. Default 8.
 *   data-i18n-buy / data-i18n-empty / data-i18n-error / data-i18n-loading
 *                      translatable UI strings (see README).
 *
 * ============================================================================
 * XSS RULE — READ THIS BEFORE EDITING:
 * Every piece of API data (product names, descriptions, alt texts) is inserted
 * into the page via document.createElement + element.textContent ONLY.
 * NEVER use innerHTML / insertAdjacentHTML / outerHTML with API strings —
 * a product named "<img src=x onerror=...>" must render as literal text,
 * not execute. URLs from the API go into el.href / el.src (attribute
 * assignment, not markup), which is safe for http(s) URLs the API returns.
 * ============================================================================
 *
 * No build step: this file is a single ES5-syntax IIFE (var/function/string
 * concat — no arrows, template literals or let/const), so it can be dropped
 * into any page or legacy bundler untouched. It does use two runtime APIs:
 * fetch and Intl.NumberFormat — both universal in every browser since ~2017.
 */
(function () {
  'use strict';

  var API_BASE = 'https://www.getly.store';
  var STYLE_ID = 'getly-widget-styles';

  /* ------------------------------------------------------------------ *
   * Themeable styles — override via CSS custom properties, e.g.:
   *   .getly-widget { --getly-accent: #7c3aed; --getly-radius: 4px; }
   * Injected once per page.
   * ------------------------------------------------------------------ */
  var CSS =
    '.getly-widget{--getly-accent:#10b981;--getly-bg:#ffffff;--getly-text:#111827;' +
    '--getly-muted:#6b7280;--getly-border:#e5e7eb;--getly-radius:12px;' +
    "--getly-font:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
    'font-family:var(--getly-font);color:var(--getly-text);' +
    'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}' +
    '.getly-widget__card{background:var(--getly-bg);border:1px solid var(--getly-border);' +
    'border-radius:var(--getly-radius);overflow:hidden;display:flex;flex-direction:column}' +
    '.getly-widget__img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:var(--getly-border)}' +
    '.getly-widget__noimg{width:100%;aspect-ratio:4/3;background:var(--getly-border)}' +
    '.getly-widget__body{padding:12px;display:flex;flex-direction:column;gap:6px;flex:1}' +
    '.getly-widget__name{font-size:14px;font-weight:600;margin:0;line-height:1.35}' +
    '.getly-widget__desc{font-size:12px;color:var(--getly-muted);margin:0;line-height:1.4;' +
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
    '.getly-widget__row{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:6px}' +
    '.getly-widget__price{font-size:15px;font-weight:700}' +
    '.getly-widget__buy{background:var(--getly-accent);color:#fff;text-decoration:none;' +
    'font-size:13px;font-weight:600;padding:7px 14px;border-radius:calc(var(--getly-radius) - 4px);white-space:nowrap}' +
    '.getly-widget__buy:hover{filter:brightness(1.08)}' +
    '.getly-widget__state{grid-column:1/-1;text-align:center;color:var(--getly-muted);' +
    'font-size:14px;padding:24px 12px;border:1px dashed var(--getly-border);border-radius:var(--getly-radius)}' +
    '@media (prefers-color-scheme:dark){.getly-widget{--getly-bg:#1f2937;--getly-text:#f9fafb;' +
    '--getly-muted:#9ca3af;--getly-border:#374151}}';

  function injectStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS; // textContent, never innerHTML — see XSS rule
    document.head.appendChild(style);
  }

  /* ------------------------------------------------------------------ */

  var DEFAULT_STRINGS = {
    buy: 'Buy',
    empty: 'No products yet',
    error: 'Could not load products',
    loading: 'Loading products…',
  };

  function readStrings(el) {
    return {
      buy: el.getAttribute('data-i18n-buy') || DEFAULT_STRINGS.buy,
      empty: el.getAttribute('data-i18n-empty') || DEFAULT_STRINGS.empty,
      error: el.getAttribute('data-i18n-error') || DEFAULT_STRINGS.error,
      loading: el.getAttribute('data-i18n-loading') || DEFAULT_STRINGS.loading,
    };
  }

  function formatPrice(priceCents, currency, locale) {
    // All Getly amounts are integer cents — divide by 100 exactly once, here.
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: currency }).format(priceCents / 100);
    } catch (e) {
      // Unknown locale/currency code → plain fallback rather than a crash.
      return (priceCents / 100).toFixed(2) + ' ' + currency;
    }
  }

  /** Pick a localized field when the API provides one (nameRu/nameDe etc.). */
  function localized(item, base, locale) {
    if (locale && locale.indexOf('ru') === 0 && item[base + 'Ru']) return item[base + 'Ru'];
    if (locale && locale.indexOf('de') === 0 && item[base + 'De']) return item[base + 'De'];
    return item[base];
  }

  function renderState(container, text) {
    // textContent-only — the message may include user-supplied i18n strings.
    while (container.firstChild) container.removeChild(container.firstChild);
    var state = document.createElement('div');
    state.className = 'getly-widget__state';
    state.textContent = text;
    container.appendChild(state);
  }

  function renderProducts(container, items, opts) {
    while (container.firstChild) container.removeChild(container.firstChild);

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var card = document.createElement('article');
      card.className = 'getly-widget__card';

      // Image (or placeholder). API-provided URL → src attribute (safe), API-
      // provided alt text → alt attribute via property assignment (safe).
      if (item.images && item.images.length > 0 && item.images[0].url) {
        var img = document.createElement('img');
        img.className = 'getly-widget__img';
        img.loading = 'lazy';
        img.src = item.images[0].url;
        img.alt = item.images[0].altText || localized(item, 'name', opts.locale) || '';
        card.appendChild(img);
      } else {
        var ph = document.createElement('div');
        ph.className = 'getly-widget__noimg';
        card.appendChild(ph);
      }

      var body = document.createElement('div');
      body.className = 'getly-widget__body';

      var name = document.createElement('h3');
      name.className = 'getly-widget__name';
      name.textContent = localized(item, 'name', opts.locale); // NEVER innerHTML
      body.appendChild(name);

      var desc = localized(item, 'shortDescription', opts.locale);
      if (desc) {
        var p = document.createElement('p');
        p.className = 'getly-widget__desc';
        p.textContent = desc; // NEVER innerHTML
        body.appendChild(p);
      }

      var row = document.createElement('div');
      row.className = 'getly-widget__row';

      var price = document.createElement('span');
      price.className = 'getly-widget__price';
      price.textContent = formatPrice(item.priceCents, opts.currency || item.currency || 'USD', opts.locale);
      row.appendChild(price);

      // Buy button opens the Getly product page in a new tab.
      // rel="noopener noreferrer" — the opened page must not get window.opener.
      var buy = document.createElement('a');
      buy.className = 'getly-widget__buy';
      buy.href = item.urls.buy;
      buy.target = '_blank';
      buy.rel = 'noopener noreferrer';
      buy.textContent = opts.strings.buy;
      row.appendChild(buy);

      body.appendChild(row);
      card.appendChild(body);
      container.appendChild(card);
    }
  }

  function mount(el) {
    if (el.getAttribute('data-getly-mounted')) return; // idempotent
    el.setAttribute('data-getly-mounted', 'true');

    var slug = el.getAttribute('data-getly-store');
    if (!slug) return;

    injectStylesOnce();
    el.className += (el.className ? ' ' : '') + 'getly-widget';

    var locale = el.getAttribute('data-locale') || 'en';
    var currency = el.getAttribute('data-currency') || ''; // '' → use API currency
    var limit = parseInt(el.getAttribute('data-limit') || '8', 10);
    if (isNaN(limit) || limit < 1) limit = 8;
    if (limit > 100) limit = 100;
    var strings = readStrings(el);
    var opts = { locale: locale, currency: currency, strings: strings };

    renderState(el, strings.loading);

    // Public endpoint: no API key, CORS *, cached ~5 min at the CDN.
    var url =
      API_BASE + '/api/v1/public/stores/' + encodeURIComponent(slug) + '/products?limit=' + limit;

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (!json || json.success !== true || !json.data) throw new Error('Bad response');
        var items = json.data.items || [];
        if (items.length === 0) {
          renderState(el, strings.empty);
        } else {
          renderProducts(el, items, opts);
        }
      })
      .catch(function () {
        renderState(el, strings.error);
      });
  }

  function mountAll() {
    var nodes = document.querySelectorAll('[data-getly-store]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  // Auto-mount: now if the DOM is ready, otherwise on DOMContentLoaded.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }

  // Manual API for SPAs that add widget containers after initial load.
  window.GetlyWidget = { mount: mount, mountAll: mountAll };
})();
