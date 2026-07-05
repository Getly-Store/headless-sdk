# Getly storefront widget

Embed your Getly store on **any** page — WordPress, Carrd, Notion-exported sites,
a hand-written HTML file — with two lines:

```html
<div data-getly-store="your-store-slug"></div>
<script src="getly-widget.js"></script>
```

- **Zero dependencies, zero build step** — one ES5-syntax IIFE file
- Uses the **public** store endpoint: no API key on the page, ever
- XSS-safe by construction: all API strings rendered via `textContent`, never `innerHTML`
- Locale-aware prices via `Intl.NumberFormat`, translatable labels, dark-mode aware
- Themeable through CSS custom properties

Open [`demo.html`](./demo.html) in a browser to see two widgets (default + a Russian,
purple-themed one).

## Attributes

| Attribute | Required | Default | Meaning |
| --- | --- | --- | --- |
| `data-getly-store` | ✅ | — | Store slug: `getly.store/store/<slug>` |
| `data-locale` | | `en` | BCP-47 locale for price formatting; also picks localized product names/descriptions when the store provides them (`ru`, `de`) |
| `data-currency` | | API value (USD) | Display currency code. **Formatting only — no conversion.** A $19.00 product with `data-currency="EUR"` renders as €19.00, which is wrong. Leave unset unless you know why. |
| `data-limit` | | `8` | Number of products, 1–100 |

## Translating the UI (`data-i18n-*`)

Four strings are rendered by the widget itself; each is overridable per-embed:

| Attribute | Default | Shown when |
| --- | --- | --- |
| `data-i18n-buy` | `Buy` | on every product's buy button |
| `data-i18n-empty` | `No products yet` | store has 0 active products |
| `data-i18n-error` | `Could not load products` | network/API failure |
| `data-i18n-loading` | `Loading products…` | while fetching |

```html
<div data-getly-store="my-store" data-locale="ru"
     data-i18n-buy="Купить" data-i18n-empty="Пока нет товаров"
     data-i18n-error="Не удалось загрузить товары" data-i18n-loading="Загрузка…"></div>
```

## Theming

The widget ships neutral styles driven entirely by CSS custom properties — override
them on the container (or any ancestor):

```css
.my-shop {
  --getly-accent: #7c3aed;   /* buy button */
  --getly-bg: #ffffff;       /* card background */
  --getly-text: #111827;
  --getly-muted: #6b7280;    /* description text */
  --getly-border: #e5e7eb;
  --getly-radius: 12px;
  --getly-font: 'Inter', system-ui, sans-serif;
}
```

Dark mode: sensible `prefers-color-scheme: dark` defaults are built in; override the
same variables to match your site exactly.

## SPA / dynamic pages

The widget auto-mounts on `DOMContentLoaded` (or immediately if the DOM is ready).
If you insert containers later:

```js
window.GetlyWidget.mountAll();          // scan the page again
window.GetlyWidget.mount(element);      // or mount one specific element
```

Mounting is idempotent — already-mounted containers are skipped.

## What it talks to

`GET https://www.getly.store/api/v1/public/stores/{slug}/products?limit=N` — a public,
CORS-enabled, CDN-cached (~5 min) endpoint that returns only **active** products of
non-suspended sellers. Response shape:

```json
{
  "success": true,
  "data": {
    "store": { "id": "…", "name": "…", "slug": "…" },
    "items": [
      {
        "id": "…", "slug": "neon-ui-kit", "name": "Neon UI Kit",
        "shortDescription": "120 dark-mode components",
        "priceCents": 1900, "currency": "USD",
        "avgRating": 4.8, "reviewCount": 12,
        "images": [{ "url": "https://…", "altText": null }],
        "urls": { "product": "https://www.getly.store/product/neon-ui-kit",
                   "buy": "https://www.getly.store/product/neon-ui-kit" }
      }
    ],
    "nextCursor": null
  }
}
```

Money is **integer cents** (`priceCents`) — the widget divides by 100 exactly once, at
display time. Buy buttons open `urls.buy` in a new tab with `rel="noopener noreferrer"`.

Rate limit: 60 requests/min per visitor IP — far above anything a normal page does,
since the CDN cache absorbs repeat loads.

## The XSS rule (if you fork this file)

All API-provided strings (names, descriptions, alt texts) go into the DOM via
`document.createElement` + `element.textContent`. **Never** switch that to
`innerHTML` / `insertAdjacentHTML` — a product named `<img src=x onerror=…>` must
render as literal text on your page, not execute. URLs are assigned to `href`/`src`
properties (attribute assignment, not markup parsing).
