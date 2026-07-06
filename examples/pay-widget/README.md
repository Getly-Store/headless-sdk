# Pay Widget example

The smallest possible integration: one `<script>` tag plus a Buy button/div that
sells a digital product from **any** website — no API key in the browser, no
Stripe account for the seller.

## Run it

Open `demo.html` in a browser (or serve the folder):

```bash
npx serve .
# then open http://localhost:3000/demo.html
```

The demo points at the seeded `getly-demo` / `demo-doc` product ($1). Clicking a
button mints a **real** checkout — you can cancel on the Stripe page.

## Use it on your own site

1. Get your snippet at **https://www.getly.store/dashboard/pay-widget** (pick a
   product → copy).
2. Paste the `<script>` once and a button per product:

   ```html
   <script src="https://www.getly.store/pay.js" async></script>
   <button data-getly-buy data-store="YOUR_STORE_SLUG" data-product="YOUR_PRODUCT_SLUG">
     Buy now
   </button>
   ```

3. Enable the widget (and, for inline Apple Pay, add your domain) at
   `/dashboard/pay-widget`.

## Modes, events, CSP, security

See the full guide: [`docs/pay-widget.md`](../../docs/pay-widget.md).

**Security:** the `getly:pay:success` browser event is advisory only — never
unlock content on it. Getly delivers the file server-side after Stripe confirms
payment; verify real sales via the `sale.completed` webhook.
