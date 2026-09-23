# Pay Widget — a Buy button for any website

Add one `<script>` tag and one button to **any** website — your own HTML page, a
Webflow/Framer/Carrd site, a landing page, a link-in-bio, a quiz funnel — and
sell a digital product through Getly. The button asks the buyer for an email
and offers every payment rail Getly can take at that moment — **PayPal and
USDT/USDC today**. Card checkout is paused; when it returns the widget offers it
again on the next page load, with no change to your embed. Getly hosts the file,
delivers it, sends the receipt, and handles refunds. **The seller needs no
payment account of their own.**

> **Approval first.** A store must be approved for the Pay Widget before the
> button can sell (`widget_not_approved` until then). Request access at
> `/dashboard/pay-widget` — tell us where the button will live.

> This is the buyer-facing embed. It is **not** the API-key surface — no key ever
> touches the browser. For programmatic checkout links (bots, servers) use
> [`createCheckoutLink`](../openapi/getly-v1.yaml) instead.

- **Landing page:** https://www.getly.store/pay-widget
- **Get your snippet:** https://www.getly.store/dashboard/pay-widget
- **MCP tool:** `get_pay_widget_code({ productSlug, mode? })`

---

## Install

```html
<!-- 1. Load once, anywhere on the page -->
<script src="https://www.getly.store/pay.js" async></script>

<!-- 2. Drop a Buy button — replace the two slugs with your own -->
<button data-getly-buy
        data-store="YOUR_STORE_SLUG"
        data-product="YOUR_PRODUCT_SLUG">
  Buy now
</button>
```

The script `src` is **unversioned on purpose** — it updates in place. Never add
an `integrity=` hash or a `?v=` query string; both would pin a stale copy.

---

## Modes (`data-mode`)

| Mode | What the buyer sees |
|------|---------------------|
| `auto` (default) | Clicking the button opens a small chooser (email + one button per rail) under it; the payment page opens in a popup on desktop, same tab on mobile |
| `popup` | Same chooser; the payment page always opens in a popup window |
| `inline` | The chooser rendered inside your `<div>` |
| `redirect` | Same chooser; the payment page opens in the same tab |

The rails come from the product endpoint's `paymentMethods`
(`GET /api/v1/public/stores/{store}/products/{product}`), so a rail that comes
back appears in every embedded button without you changing anything. PayPal and
crypto need the buyer's email before the redirect — that is where the receipt and
download links go. If the card rail is live and it is the only rail, the button
skips the chooser and opens card checkout directly (inline mode then embeds the
card form).

```html
<!-- Inline (embedded) checkout -->
<script src="https://www.getly.store/pay.js" async></script>
<div data-getly-buy
     data-store="YOUR_STORE_SLUG"
     data-product="YOUR_PRODUCT_SLUG"
     data-mode="inline"></div>
```

---

## All `data-*` attributes

| Attribute | Required | Description |
|-----------|----------|-------------|
| `data-getly-buy` | ✅ | Marks the element as a Getly buy trigger (`<button>` or `<a>` for popup/redirect; `<div>` for inline). |
| `data-store` | ✅ | Your store slug. |
| `data-product` | ✅ | The product slug (not the uuid). |
| `data-link` | — | The id of an API-minted checkout link — its coupon, affiliate code, reference and success URL are reused. |
| `data-mode` | — | `auto` (default), `popup`, `inline`, `redirect`. |
| `data-success-url` | — | Absolute URL the buyer lands on after paying (popup/redirect). Defaults to the Getly success page. |
| `data-price` | — | `show` appends the live price to the button label. |
| `data-locale` | — | `en` (default), `ru`, `de` — localizes the widget's own UI strings. |
| `data-i18n-buy` / `data-i18n-loading` / `data-i18n-error` | — | Override individual widget strings. |

---

## Events

The widget dispatches events on the trigger element (and bubbles them to
`document`):

| Event | When |
|-------|------|
| `getly:pay:ready` | The widget wired up the button. |
| `getly:pay:method` | The buyer picked a rail (`event.detail.method` = `paypal` / `crypto` / `card`). |
| `getly:pay:open` | Checkout opened (popup shown / redirecting). |
| `getly:pay:success` | The status poll saw the checkout completed. |
| `getly:pay:error` | Mint or load failed (`event.detail.code` carries the reason). |
| `getly:pay:close` | The buyer closed the popup / cancelled. |

> ⚠️ **Security — read this.** `getly:pay:success` is an **advisory UI signal
> only**. A visitor can forge it from the console. **Never unlock a file, a
> license key, or paid content on the client in response to it.** Getly delivers
> the product **server-side** (buyer email + their Getly library) once the payment
> provider confirms the payment. If your own backend needs to react to a real sale, verify
> it through the **`sale.completed` / `checkout_link.completed` webhook**, never
> the browser event.

---

## Quiz funnels & dynamic products

Set the product at runtime (e.g. from a quiz result), then tell the widget to
re-scan for new buttons:

```html
<button id="buy" data-getly-buy data-store="YOUR_STORE_SLUG">Get your report</button>

<script src="https://www.getly.store/pay.js" async></script>
<script>
  // e.g. result === "focus" sells the "focus-report" product
  const btn = document.getElementById('buy');
  btn.setAttribute('data-product', result + '-report');
  window.GetlyPay && window.GetlyPay.scan(); // re-scan after DOM changes
</script>
```

`window.GetlyPay.scan()` is also how you wire up buttons added by a SPA after the
initial page load.

---

## Content Security Policy

If your site sends a CSP, allow the widget per mode:

**Popup / redirect (default):**
```
script-src  https://www.getly.store
connect-src https://www.getly.store
```

**Inline with the card rail live (adds Stripe.js)** — only needed when card
checkout is available again:
```
script-src  https://www.getly.store https://js.stripe.com
connect-src https://www.getly.store https://api.stripe.com
frame-src   https://js.stripe.com
```

The widget only ever injects ONE external script — `js.stripe.com`, for inline
card checkout — and never uses `eval`, `innerHTML`, or `import()`. PayPal and
crypto open on the provider's own page, so they need nothing in your CSP.
Anti-abuse verification (Cloudflare Turnstile) never runs on your page: when a
checkout needs it, the popup is sent to Getly's own `/pay/challenge` page,
solves it there, and continues to payment.

---

## Under the hood (the two public endpoints)

The widget is a thin client over two no-auth endpoints (documented in
[`openapi/getly-v1.yaml`](../openapi/getly-v1.yaml)):

- `POST /api/v1/public/checkout` → mints a one-shot checkout for `{ storeSlug,
  productSlug, method, email }` (or `{ linkId, method, email }`) and returns
  `{ method, url, linkId, priceCents }` — the hosted PayPal / crypto page (or,
  with the card rail live, card checkout; `clientSecret` in inline card mode).
  A rail that is not live answers 409 `payment_method_unavailable` with the live
  `paymentMethods`. `check: true` runs every configuration check and stops
  before any payment. **The price is read from the product row — the browser
  cannot set it.** From code: `getly.publicCheckout.create()` / `.check()` in
  `@getly/sdk`.
- `GET /api/v1/public/checkout/{linkId}/status` → returns `{ status }`
  (`open | completed | expired`) for the poll. Nothing else — no amount, no
  buyer.

You normally never call these directly. Anti-abuse (velocity limits, origin
allowlist, per-store kill switch, Turnstile for untrusted stores) is enforced
server-side on the mint.

---

## The 3 things only a human can do

1. **Request access** to the widget at `/dashboard/pay-widget` (a manual
   review) and, once approved, set the optional domain allowlist there.
2. **Save a payout wallet** at `/dashboard/settings?tab=payments` so the money
   actually lands — payouts are USDT/USDC on BNB Smart Chain (minimum $5) or
   USDT on Tron (minimum $15), on the 1st and 15th.
3. **Publish the product** you are selling (active, fixed price above $0 — free
   and pay-what-you-want products sell on their product page).
