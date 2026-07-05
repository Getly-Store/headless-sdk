# @getly/nextjs

Next.js App Router adapters for [Getly](https://www.getly.store/developers) — sell digital products from your own site with two copy-paste route handlers:

- **`Checkout()`** — a `GET` handler that mints a Getly checkout link server-side (your API key never reaches the browser) and 303-redirects the visitor to the hosted checkout.
- **`Webhooks()`** — a `POST` handler that verifies the timestamped `X-Getly-Signature-V2` header (timing-safe HMAC, 300s replay tolerance) and dispatches typed event callbacks.

Both factories return plain `(req: Request) => Promise<Response>` functions — there is **no runtime import of `next`** (it's a type-only, optional peer), so they also work in any framework that speaks the web `Request`/`Response` standard.

## Install

```bash
npm install @getly/nextjs @getly/sdk
```

Set your API key in the environment (create one at <https://www.getly.store/dashboard/developer/keys>):

```bash
# .env.local
GETLY_API_KEY=getly_sk_live_…
GETLY_WEBHOOK_SECRET=whsec…   # returned ONCE by getly.webhookEndpoints.create()
```

Never hardcode keys and never commit `.env.local`.

## Checkout — a "Buy now" link in one file

```ts
// app/api/buy/route.ts
import { Checkout } from '@getly/nextjs';

export const GET = Checkout({
  productId: 'a1b2c3d4-…', // your Getly product id
});
```

Point any button at it:

```tsx
<a href="/api/buy">Buy now — $19</a>
```

The handler creates (or reuses — creation is naturally idempotent per product + coupon + reference) an open checkout link and answers `303 Location: https://www.getly.store/go/…`. Guest checkout — buyers don't need a Getly account.

### With a coupon, success URL and per-visitor reference

```ts
// app/api/buy/route.ts
import { Checkout } from '@getly/nextjs';

export const GET = Checkout({
  productId: 'a1b2c3d4-…',
  coupon: 'LAUNCH20',
  successUrl: 'https://your.site/thanks',
  // Correlation id (≤200 chars) echoed into sale.completed webhooks:
  reference: (req) => new URL(req.url).searchParams.get('ref') ?? 'site',
});
```

### Dynamic product per request

`productId` can be a function returning a product id or a full checkout-link create input:

```ts
// app/api/buy/[product]/route.ts — Next 15+: params are async, so resolve
// the product from the URL inside the factory callback instead.
import { Checkout } from '@getly/nextjs';

export const GET = Checkout({
  productId: (req) => {
    const url = new URL(req.url);
    const slugToId: Record<string, string> = {
      'icon-pack': 'a1b2c3d4-…',
      'ui-kit': 'e5f6a7b8-…',
    };
    const id = slugToId[url.pathname.split('/').pop() ?? ''];
    return { productId: id, metadata: { source: 'pricing-page' } };
  },
});
```

Errors never leak internals: the visitor sees a generic `502 Checkout unavailable (<code>)` (or `404` when the product doesn't exist).

## Webhooks — verified events in one file

First register an endpoint (once, e.g. in a setup script):

```ts
import { Getly } from '@getly/sdk';
const getly = new Getly();
const endpoint = await getly.webhookEndpoints.create({
  url: 'https://your.site/api/webhooks/getly',
  events: ['sale.completed', 'order.refunded', 'checkout_link.completed', 'license.activated'],
});
console.log(endpoint.secret); // shown ONCE — put it in GETLY_WEBHOOK_SECRET
```

Then handle deliveries:

```ts
// app/api/webhooks/getly/route.ts
import { Webhooks } from '@getly/nextjs';

export const POST = Webhooks({
  secret: process.env.GETLY_WEBHOOK_SECRET!,

  onSaleCompleted: async (data) => {
    // data carries orderId, amounts in integer cents, and — for checkout-link
    // sales — your checkoutLinkId / reference / metadata.
    console.log('paid:', data.orderId, data.reference);
  },

  onOrderRefunded: async (data) => {
    console.log('refunded:', data.orderId);
  },

  onCheckoutLinkCompleted: async (data) => {
    console.log('link completed:', data.checkoutLinkId);
  },

  onLicenseActivated: async (data) => {
    console.log('license activated:', data.licenseKeyId, data.fingerprint);
  },

  // Optional catch-all — runs for EVERY verified event:
  onEvent: async (event) => {
    console.log('event:', event.event);
  },
});
```

Behavior:

| Case | Response |
|---|---|
| Invalid / missing / stale signature | `401` — handlers never run |
| Verified but unparseable body | `400` |
| Your handler throws | `500` — Getly retries the delivery with backoff |
| Verified event (handled or not) | `200` |

Signature verification reads the **raw** request body (`await req.text()`), recomputes `HMAC-SHA256(secret, "<t>.<rawBody>")` from the `t=<unix>,v1=<hex>` header, compares timing-safe, and rejects timestamps older than `toleranceSec` (default 300) to block replays.

## API

### `Checkout(options)`

| Option | Type | Description |
|---|---|---|
| `productId` | `string \| (req) => string \| CheckoutLinkCreateInput` | **Required.** Product to sell, or a per-request resolver. |
| `coupon?` | `string` | Coupon code auto-applied at checkout. |
| `successUrl?` | `string` | `https` URL the buyer lands on after payment. |
| `reference?` | `string \| (req) => string` | Correlation id echoed into `sale.completed`. |
| `apiKey?` | `string` | Defaults to `process.env.GETLY_API_KEY`. |
| `baseUrl?`, `fetch?` | | Testing/instrumentation overrides. |

### `Webhooks(options)`

| Option | Type | Description |
|---|---|---|
| `secret` | `string` | **Required.** The endpoint's HMAC secret (returned once at creation). |
| `toleranceSec?` | `number` | Max signature age in seconds. Default `300`. |
| `onSaleCompleted?` `onOrderRefunded?` `onCheckoutLinkCompleted?` `onLicenseActivated?` | `(data, event) => void \| Promise<void>` | Typed per-event handlers. |
| `onEvent?` | `(event) => void \| Promise<void>` | Catch-all for every verified event. |

## License

MIT — see the repository [LICENSE](https://github.com/Getly-Store/headless-sdk/blob/main/LICENSE).
