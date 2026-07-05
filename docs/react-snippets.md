# React snippets — copy-paste storefront components

shadcn-style: **you own the code.** Copy a component into your project, restyle it,
delete what you don't need. No SDK, no API key — these use only Getly's **public**
endpoints, so they're safe in any client bundle.

Works with plain React, Next.js (both `use client` and Server Components — RSC
variant below), Remix, Vite… anything that renders React 18+.

## The contract (both components rely on this)

```
GET https://www.getly.store/api/v1/public/stores/{storeSlug}/products?limit=N&cursor=C
GET https://www.getly.store/api/v1/public/stores/{storeSlug}/products/{productSlug}
```

- No auth. CORS `*`. CDN-cached ~5 min.
- Success: `{ success: true, data: { store, items, nextCursor } }` (list) or
  `{ success: true, data: <product> }` (single).
- Error: `{ success: false, error, errorDetail: { code, message, hint } }`.
- Money is **integer cents** — `priceCents: 1900` means $19.00. Divide by 100 once,
  at display time.
- Only `active` products of non-suspended sellers are returned; unknown store → 404.
- `urls.buy` is the checkout entry point — link to it, don't build your own cart.
- The public API is **slug-addressed** (product slugs, not ids) — ids only exist on
  the authenticated seller API.

## Shared types (`getly-types.ts`)

```ts
export interface GetlyImage {
  url: string;
  altText: string | null;
}

export interface GetlyProduct {
  id: string;
  slug: string;
  name: string;
  nameRu?: string;
  nameDe?: string;
  shortDescription: string | null;
  /** Present only on the single-product endpoint. */
  description?: string | null;
  /** Integer minor units: 1900 = $19.00. The only money field you should read. */
  priceCents: number;
  currency: 'USD';
  avgRating: number;
  reviewCount: number;
  images: GetlyImage[];
  urls: { product: string; buy: string };
}

export interface GetlyStorefrontData {
  store: { id: string; name: string; slug: string };
  items: GetlyProduct[];
  nextCursor: string | null;
}

export const GETLY_API = 'https://www.getly.store/api/v1/public';

export function formatGetlyPrice(priceCents: number, currency = 'USD', locale = 'en') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(priceCents / 100);
}
```

## `<GetlyStorefront />` — client component

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  GETLY_API,
  formatGetlyPrice,
  type GetlyStorefrontData,
} from './getly-types';

interface GetlyStorefrontProps {
  store: string;          // store slug: getly.store/store/<slug>
  limit?: number;         // 1–100, default 8
  locale?: string;        // price formatting locale
}

export function GetlyStorefront({ store, limit = 8, locale = 'en' }: GetlyStorefrontProps) {
  const [data, setData] = useState<GetlyStorefrontData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');

    fetch(`${GETLY_API}/stores/${encodeURIComponent(store)}/products?limit=${limit}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!json.success) throw new Error(json.error ?? 'Bad response');
        setData(json.data);
        setState('ready');
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setState('error');
      });

    return () => controller.abort();
  }, [store, limit]);

  if (state === 'loading') return <p className="text-sm text-muted-foreground">Loading products…</p>;
  if (state === 'error') return <p className="text-sm text-muted-foreground">Could not load products.</p>;
  if (!data || data.items.length === 0)
    return <p className="text-sm text-muted-foreground">No products yet.</p>;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {data.items.map((p) => (
        <article key={p.id} className="flex flex-col overflow-hidden rounded-xl border">
          {p.images[0] ? (
            // API strings render as text via JSX (React escapes them);
            // never dangerouslySetInnerHTML with API data.
            <img
              src={p.images[0].url}
              alt={p.images[0].altText ?? p.name}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover"
            />
          ) : (
            <div className="aspect-[4/3] w-full bg-muted" />
          )}
          <div className="flex flex-1 flex-col gap-1 p-3">
            <h3 className="text-sm font-semibold">{p.name}</h3>
            {p.shortDescription && (
              <p className="line-clamp-2 text-xs text-muted-foreground">{p.shortDescription}</p>
            )}
            <div className="mt-auto flex items-center justify-between pt-2">
              <span className="text-sm font-bold">
                {formatGetlyPrice(p.priceCents, p.currency, locale)}
              </span>
              <a
                href={p.urls.buy}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
              >
                Buy
              </a>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
```

## `<GetlyBuyButton />` — client component

One product, one button, live price. The public API addresses products by **slug**
(within a store), so the props are `storeSlug` + `productSlug` — you'll find both in
the product's URL: `getly.store/product/<productSlug>`.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { GETLY_API, formatGetlyPrice, type GetlyProduct } from './getly-types';

interface GetlyBuyButtonProps {
  storeSlug: string;
  productSlug: string;
  locale?: string;
  /** Custom label; defaults to "Buy — $XX.XX". */
  children?: React.ReactNode;
}

export function GetlyBuyButton({ storeSlug, productSlug, locale = 'en', children }: GetlyBuyButtonProps) {
  const [product, setProduct] = useState<GetlyProduct | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `${GETLY_API}/stores/${encodeURIComponent(storeSlug)}/products/${encodeURIComponent(productSlug)}`,
      { signal: controller.signal },
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json) => (json.success ? setProduct(json.data) : setFailed(true)))
      .catch((err) => {
        if (err.name !== 'AbortError') setFailed(true);
      });
    return () => controller.abort();
  }, [storeSlug, productSlug]);

  // 404 (product unpublished/removed) or network failure → render nothing
  // rather than a dead button.
  if (failed) return null;

  if (!product) {
    return (
      <span className="inline-block animate-pulse rounded-lg bg-muted px-4 py-2 text-sm">…</span>
    );
  }

  return (
    <a
      href={product.urls.buy}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
    >
      {children ?? `Buy — ${formatGetlyPrice(product.priceCents, product.currency, locale)}`}
    </a>
  );
}
```

## RSC variant — `<GetlyStorefrontRSC />` (Next.js App Router)

No client JS at all: the fetch happens on the server and revalidates every 5 minutes
(matching the endpoint's CDN cache).

```tsx
// app/components/getly-storefront-rsc.tsx — a Server Component (no 'use client')
import { GETLY_API, formatGetlyPrice, type GetlyStorefrontData } from './getly-types';

interface Props {
  store: string;
  limit?: number;
  locale?: string;
}

export async function GetlyStorefrontRSC({ store, limit = 8, locale = 'en' }: Props) {
  let data: GetlyStorefrontData | null = null;

  try {
    const res = await fetch(
      `${GETLY_API}/stores/${encodeURIComponent(store)}/products?limit=${limit}`,
      { next: { revalidate: 300 } }, // match the API's 5-min CDN cache
    );
    if (res.ok) {
      const json = await res.json();
      if (json.success) data = json.data;
    }
  } catch {
    // fall through to the empty state — a storefront hiccup must not 500 your page
  }

  if (!data || data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">No products yet.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {data.items.map((p) => (
        <article key={p.id} className="flex flex-col overflow-hidden rounded-xl border">
          {p.images[0] ? (
            <img
              src={p.images[0].url}
              alt={p.images[0].altText ?? p.name}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover"
            />
          ) : (
            <div className="aspect-[4/3] w-full bg-muted" />
          )}
          <div className="flex flex-1 flex-col gap-1 p-3">
            <h3 className="text-sm font-semibold">{p.name}</h3>
            {p.shortDescription && (
              <p className="line-clamp-2 text-xs text-muted-foreground">{p.shortDescription}</p>
            )}
            <div className="mt-auto flex items-center justify-between pt-2">
              <span className="text-sm font-bold">
                {formatGetlyPrice(p.priceCents, p.currency, locale)}
              </span>
              <a
                href={p.urls.buy}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
              >
                Buy
              </a>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
```

Usage:

```tsx
// Client (any React app):
<GetlyStorefront store="neon-ui" limit={8} />
<GetlyBuyButton storeSlug="neon-ui" productSlug="neon-ui-kit" />

// Server (Next.js App Router):
<GetlyStorefrontRSC store="neon-ui" limit={8} />
```

## Notes

- Class names assume Tailwind (+ shadcn's `text-muted-foreground` / `bg-muted`
  tokens); swap them for your own CSS freely — there's no logic in the styles.
- Pagination: pass `data.nextCursor` back as `&cursor=` to fetch the next page.
  Cursor is an opaque string — don't parse it.
- Want to sell in-page with coupons/reference tracking instead of linking out?
  That needs the authenticated API (checkout links) — use
  [`@getly/sdk`](../packages/sdk-js) **server-side only**; never put an API key in
  client code.
