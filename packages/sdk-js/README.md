# @getly/sdk

Zero-dependency TypeScript client for the [Getly](https://www.getly.store/developers) v1 API — run a digital-products store from code: products, blog posts, coupons, checkout links, license keys, webhooks, and Getly Billing subscriptions for your own product.

- **Zero runtime dependencies** — built on global `fetch` (Node ≥ 18).
- **Typed errors** — every failure throws `GetlyError` with a stable machine `code`, an actionable `hint`, and the rate-limit snapshot.
- **Reliability built in** — automatic `Idempotency-Key` on every create, 429 retries honoring `Retry-After`, proactive throttling from `X-RateLimit-Remaining`.
- **Money is always integer cents** — `priceCents`, `discountedPriceCents`, `amountCents`. No floats, ever.

## Install

```bash
npm install @getly/sdk
```

## Quickstart

```ts
import { Getly } from '@getly/sdk';

// Reads GETLY_API_KEY from the environment — never hardcode keys.
// Create one at https://www.getly.store/dashboard/developer/keys
const getly = new Getly();

// 1. Create a product ($19.00 → 1900 cents)
const product = await getly.products.create({
  name: 'Notion Template — Freelance OS',
  priceCents: 1900,
  shortDescription: 'Everything a freelancer needs in one workspace.',
});

// 2. Upload the deliverable (presign → PUT → attach, one call)
import { readFile } from 'node:fs/promises';
await getly.products.uploadFile(product.id, {
  fileName: 'freelance-os.zip',
  data: await readFile('./freelance-os.zip'),
  fileType: 'application/zip',
});

// 3. Publish
await getly.products.publish(product.id);

// 4. Mint a payment link and send it to your buyer
const link = await getly.checkoutLinks.create({
  productId: product.id,
  reference: 'telegram-chat-42',
});
console.log(link.url); // https://www.getly.store/go/…
```

## Configuration

```ts
const getly = new Getly({
  apiKey: process.env.GETLY_API_KEY, // default — omit unless you must override
  baseUrl: 'https://www.getly.store', // default
  maxRetries: 2,   // automatic 429 retries (idempotent-safe calls only)
  throttle: true,  // wait for the window when X-RateLimit-Remaining <= 1
});
```

Security: the key is only ever sent as `Authorization: Bearer …` to the configured `baseUrl`. It is never logged, never attached to presigned storage uploads, and never accepted as a CLI argument.

## Resources

| Namespace | Methods |
|---|---|
| `getly.products` | `list`, `iterate`, `get`, `create`, `update`, `archive`, `publish`, `listFiles`, `presignFile`, `attachFile`, `uploadFile`, `createMany` |
| `getly.products.keys` | `list`, `iterate`, `add`, `addMany`, `remove` — your own license-key pool |
| `getly.posts` | `list`, `iterate`, `get`, `create`, `update`, `delete` |
| `getly.coupons` | `list`, `iterate`, `create`, `update`, `delete` |
| `getly.checkoutLinks` | `create`, `list`, `iterate`, `get` (status polling) |
| `getly.licenses` | `list`, `iterate`, `validate`*, `activate`*, `deactivate`* |
| `getly.uploads` | `presignImage`, `uploadImage` |
| `getly.webhookEndpoints` | `list`, `create`, `update`, `delete` |
| `getly.store` | `get`, `create`, `update`, `payoutOnboarding` (deprecated) |
| `getly.payouts` | `get` |
| `getly.orders` | `list`, `iterate`, `get` — each order carries the buyer's email |
| `getly.analytics` | `get` |
| `getly.billing` | `createCheckout`, `plans.{list,get,create,update}`, `subscriptions.{list,iterate,get,cancel}` |
| `getly.publicStore`* | `products`, `product` (with `paymentMethods`), `iterateProducts` |
| `getly.publicCheckout`* | `create`, `check`, `status` — the Pay Widget checkout |

\* public — works **without** an API key (license checks from shipped software, storefront widgets, the Pay Widget).

**Payments today.** Buyers pay with PayPal or USDT/USDC; card checkout is paused and may return — `publicStore.product()` returns the live `paymentMethods`. Seller payouts go out on the 1st and 15th in USDT/USDC on BNB Smart Chain (minimum $5) or USDT on Tron (minimum $15); the wallet is saved in the dashboard. `store.payoutOnboarding()` returns a Stripe Connect link that is no longer a payout route — do not send sellers there.

## Sell your own license keys (key pool)

```ts
const product = await getly.products.create({ name: 'Game key', priceCents: 1500, keyPoolEnabled: true });
await getly.products.keys.add(product.id, ['AAAA-BBBB-0001', 'AAAA-BBBB-0002']); // ≤5000 per call; addMany() chunks
const pool = await getly.products.keys.list(product.id); // counts { available, issued, waiting } + masked keys
```

Each sale hands the buyer the next unsold key in the order you added them; `sale.completed` carries it as `items[].licenseKey` (`null` while the pool is empty — the buyer gets it by email as soon as you add more). `keyPoolEnabled` and `licenseKeysEnabled` (Getly-generated keys) are mutually exclusive. `keys.remove()` deletes an unsold key; an issued key answers `key_not_available`.

## Getly Billing (recurring plans for your own product)

```ts
const plan = await getly.billing.plans.create({ name: 'Pro', amount: 1900, intervalUnit: 'month', externalId: 'pro-monthly' });
const { url } = await getly.billing.createCheckout({
  planId: plan.id,
  customerRef: user.id,               // echoed on every billing.* webhook as externalCustomerRef
  successUrl: 'https://your-app.com/welcome',
  cancelUrl: 'https://your-app.com/pricing',
});
// later — the status check before granting access:
const sub = await getly.billing.subscriptions.get(subscriptionId);
const entitled = sub.status === 'active' || sub.status === 'past_due';
```

Writes need an approved Billing application (`billing_not_approved` until then — apply at `/dashboard/billing`); reads work immediately. Scopes `read:billing` / `write:billing`.

## Error handling

```ts
import { GetlyError } from '@getly/sdk';

try {
  await getly.products.publish(id);
} catch (err) {
  if (err instanceof GetlyError) {
    err.code;      // 'not_publishable' — stable machine code, branch on this
    err.hint;      // what to DO next (written for humans and LLMs)
    err.reasons;   // publish blockers: [{ code: 'missing_file', detail: '…' }]
    err.details;   // extra errorDetail fields, e.g. paymentMethods, challengeSiteKey
    err.rateLimit; // { limit, remaining, resetSeconds, retryAfterSeconds }
  }
}
```

Code registry: `unauthorized`, `insufficient_scope`, `rate_limited`, `validation_failed`, `not_found`, `publish_requires_file`, `publish_requires_image`, `publish_requires_category`, `category_not_allowed`, `moderation_locked`, `not_publishable`, `idempotency_conflict`, `coupon_invalid`, `high_discount_ack_required`, `quota_exceeded`, `expired`, `license_invalid`, `license_expired`, `activation_limit_reached`, `not_purchasable`, `widget_disabled`, `widget_not_approved`, `origin_not_allowed`, `challenge_required`, `payment_method_unavailable`, `already_completed`, `key_not_available`, `billing_not_approved`, `plan_exists`, `plan_inactive`, `subscription_not_cancellable`, `unknown_endpoint`, `internal_error`.

## Idempotency & retries

Every create automatically sends a fresh `Idempotency-Key` (UUID), so the SDK can safely retry 429s — the server replays the stored response instead of duplicating the resource. Pass your own key for cross-process dedupe:

```ts
await getly.products.create(input, { idempotencyKey: `import:${row.id}` });
```

## Pagination

Lists return `{ items, nextCursor }`. Use the async iterators to walk everything:

```ts
for await (const product of getly.products.iterate({ status: 'active' })) {
  console.log(product.name, product.priceCents);
}
```

## Bulk import

```ts
const results = await getly.products.createMany(rows, {
  concurrency: 2,                       // respects the 30/min mutation sublimit
  idempotencyKeyPrefix: 'import-2026-07-04', // re-runs replay, never duplicate
  onProgress: (r, done, total) => console.log(`${done}/${total}`, r.ok),
});
// per-item: { index, ok, product | error }
// quota_exceeded (100 products/day/key) stops the batch; re-run tomorrow with
// the SAME prefix to resume.
```

## Webhook signature verification

```ts
import { verifyWebhookSignature } from '@getly/sdk';

const rawBody = await req.text(); // EXACT raw body — do not re-serialize
const ok = verifyWebhookSignature({
  payload: rawBody,
  header: req.headers.get('x-getly-signature-v2'),
  secret: process.env.GETLY_WEBHOOK_SECRET!,
});
if (!ok) return new Response('invalid signature', { status: 401 });
```

Scheme: `X-Getly-Signature-V2: t=<unix>,v1=<hmacSha256(secret, t + "." + body)>`, timing-safe comparison, 300s replay tolerance. Using Next.js? `@getly/nextjs` wraps this into a ready route handler.

Typed payloads: parse the body as `TypedGetlyWebhookEvent` and narrow on `event` (or use `isWebhookEvent(evt, 'sale.completed')`). `sale.completed` carries `buyerEmail` and `items[].orderItemId` / `isGift` / `licenseKey` — keys from your pool (or Getly-generated) arrive in `licenseKey`; if you issue keys yourself, send them to `buyerEmail`. `WEBHOOK_EVENT_TYPES` lists all 18 subscribable events, including `billing.*`.

## License keys (from your shipped software)

```ts
// No API key needed — safe to call from client apps:
const check = await getly.licenses.validate({ key: userEnteredKey });
// A timed-access key whose period ended answers { valid: false, reason: 'expired', expiresAt }.
if (check.valid) {
  await getly.licenses.activate({ key: userEnteredKey, fingerprint: machineId, label: 'MacBook Pro' });
}
```

## Limits & roadmap

- File uploads: max **2GB** per file (single presigned PUT). Multipart upload for larger files is on the roadmap — today the SDK fails fast with a clear error.
- `verifyWebhookSignature` uses `node:crypto` — every Node ≥ 18 runtime (including Vercel/Netlify functions). Pure-WebCrypto edge runtime support is on the roadmap.
- Test-mode keys, hosted MCP: see the [repo roadmap](https://github.com/Getly-Store/headless-sdk#roadmap).

## License

MIT
