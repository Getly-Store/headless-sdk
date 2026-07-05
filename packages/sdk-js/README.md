# @getly/sdk

Zero-dependency TypeScript client for the [Getly](https://www.getly.store/developers) v1 API — run a digital-products store from code: products, blog posts, coupons, checkout links, license keys, webhooks.

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
| `getly.products` | `list`, `iterate`, `get`, `create`, `update`, `archive`, `publish`, `presignFile`, `attachFile`, `uploadFile`, `createMany` |
| `getly.posts` | `list`, `iterate`, `get`, `create`, `update`, `delete` |
| `getly.coupons` | `list`, `iterate`, `create`, `update`, `delete` |
| `getly.checkoutLinks` | `create`, `list`, `iterate`, `get` (status polling) |
| `getly.licenses` | `list`, `iterate`, `validate`*, `activate`*, `deactivate`* |
| `getly.uploads` | `presignImage`, `uploadImage` |
| `getly.webhookEndpoints` | `list`, `create`, `update`, `delete` |
| `getly.store` | `get`, `create`, `update`, `payoutOnboarding` |
| `getly.payouts` | `get` |
| `getly.orders` | `list`, `iterate`, `get` |
| `getly.publicStore`* | `products`, `product`, `iterateProducts` |

\* public — works **without** an API key (license checks from shipped software, storefront widgets).

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
    err.rateLimit; // { limit, remaining, resetSeconds, retryAfterSeconds }
  }
}
```

Code registry: `unauthorized`, `insufficient_scope`, `rate_limited`, `validation_failed`, `not_found`, `publish_requires_file`, `moderation_locked`, `not_publishable`, `idempotency_conflict`, `coupon_invalid`, `high_discount_ack_required`, `quota_exceeded`, `expired`, `license_invalid`, `activation_limit_reached`, `internal_error`.

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
// quota_exceeded (20 products/day/key) stops the batch; re-run tomorrow with
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

## License keys (from your shipped software)

```ts
// No API key needed — safe to call from client apps:
const check = await getly.licenses.validate({ key: userEnteredKey });
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
