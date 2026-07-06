# Pay Widget — a Buy button for any website

Add one `<script>` tag and one button to **any** website — your own HTML page, a
Webflow/Framer/Carrd site, a landing page, a link-in-bio, a quiz funnel — and
sell a digital product through Getly. Buyers pay by card, **Apple Pay / Google
Pay**, or crypto; Getly hosts the file, delivers it, sends the receipt, and
handles refunds. **The seller needs no Stripe account of their own.**

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

| Mode | What the buyer sees | Apple Pay / Google Pay |
|------|---------------------|------------------------|
| `auto` (default) | Popup on desktop, same-tab redirect on mobile | Automatic |
| `popup` | Always a hosted Getly checkout in a popup window | Automatic |
| `inline` | An embedded Stripe form rendered inside your `<div>` | After you register the domain (see below) |
| `redirect` | Same-tab navigation to the hosted checkout | Automatic |

Popup/auto/redirect use Stripe's **hosted** checkout, so Apple Pay and Google Pay
appear automatically with **no domain registration**. Inline renders on your own
page, so Apple Pay needs the embedding domain registered — add it once at
`/dashboard/pay-widget` (we register it with the payment provider for you).

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
| `getly:pay:open` | Checkout opened (popup shown / inline mounted / redirecting). |
| `getly:pay:success` | The status poll saw the checkout completed. |
| `getly:pay:error` | Mint or load failed (`event.detail.code` carries the reason). |
| `getly:pay:close` | The buyer closed the popup / cancelled. |

> ⚠️ **Security — read this.** `getly:pay:success` is an **advisory UI signal
> only**. A visitor can forge it from the console. **Never unlock a file, a
> license key, or paid content on the client in response to it.** Getly delivers
> the product **server-side** (buyer email + their Getly library) once Stripe
> confirms the payment. If your own backend needs to react to a real sale, verify
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

**Inline (adds Stripe.js + Turnstile):**
```
script-src  https://www.getly.store https://js.stripe.com https://challenges.cloudflare.com
connect-src https://www.getly.store https://api.stripe.com
frame-src   https://js.stripe.com https://challenges.cloudflare.com
```

The widget only ever injects two external scripts — `js.stripe.com` and
`challenges.cloudflare.com` — and never uses `eval`, `innerHTML`, or `import()`.

---

## Under the hood (the two public endpoints)

The widget is a thin client over two no-auth endpoints (documented in
[`openapi/getly-v1.yaml`](../openapi/getly-v1.yaml)):

- `POST /api/v1/public/checkout` → mints a one-shot checkout for `{ storeSlug,
  productSlug, mode }` and returns a hosted `url` (popup/redirect) or a
  `clientSecret` (inline). **The price is read from the product row — the browser
  cannot set it.**
- `GET /api/v1/public/checkout/{linkId}/status` → returns `{ status }`
  (`open | completed | expired`) for the poll. Nothing else — no amount, no
  buyer.

You normally never call these directly. Anti-abuse (velocity limits, origin
allowlist, per-store kill switch, Turnstile for untrusted stores) is enforced
server-side on the mint.

---

## The 3 things only a human can do

1. **Enable the widget** and (optionally) set the domain allowlist at
   `/dashboard/pay-widget`.
2. **Register a domain for inline Apple Pay** (same page — one click).
3. **Connect a payout method** (bank via Stripe Connect, or a crypto wallet) so
   the money actually lands.
