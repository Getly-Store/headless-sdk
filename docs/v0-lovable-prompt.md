# v0 / Lovable / Bolt prompt — generate a storefront for your Getly store

Paste the block below into [v0.dev](https://v0.dev), [Lovable](https://lovable.dev),
[Bolt](https://bolt.new) or any AI app builder. Replace `YOUR_STORE_SLUG` (2 places)
with your store slug — the part after `/store/` in your Getly storefront URL.

The prompt embeds the complete endpoint contract, so the generator needs no other
docs, no SDK and no API key: the endpoint is public and CORS-enabled.

---

````text
Build a polished storefront web page for my digital-products store, powered by the
Getly public API. Single page, responsive, production-quality visuals.

## Data source (public, no auth, CORS enabled — call it directly from the browser)

GET https://www.getly.store/api/v1/public/stores/YOUR_STORE_SLUG/products?limit=24

Successful response (HTTP 200):

{
  "success": true,
  "data": {
    "store": { "id": "uuid", "name": "Store Name", "slug": "store-slug" },
    "items": [
      {
        "id": "uuid",
        "slug": "neon-ui-kit",
        "name": "Neon UI Kit",
        "shortDescription": "120 dark-mode components for Figma",   // may be null
        "priceCents": 1900,          // INTEGER CENTS: 1900 = $19.00
        "currency": "USD",
        "avgRating": 4.8,            // 0 when unrated
        "reviewCount": 12,
        "images": [ { "url": "https://...", "altText": "..." } ],   // 0–3 images
        "urls": {
          "product": "https://www.getly.store/product/neon-ui-kit",
          "buy":     "https://www.getly.store/product/neon-ui-kit"
        }
      }
    ],
    "nextCursor": "b64string-or-null"  // pass back as &cursor= for the next page
  }
}

Error response (HTTP 4xx/5xx) — e.g. wrong store slug returns 404:

{ "success": false, "error": "Store not found",
  "errorDetail": { "code": "not_found", "message": "Store not found", "hint": "..." } }

Also available for a product detail view (adds "description", may contain long text):
GET https://www.getly.store/api/v1/public/stores/YOUR_STORE_SLUG/products/{productSlug}

## Hard rules

1. MONEY: prices arrive as integer cents in `priceCents`. Divide by 100 exactly once,
   at display time, and format with
   `new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency })`.
   Never do arithmetic on formatted strings. Ignore any other price-looking fields.
2. BUY: every product's buy button is a plain link to `item.urls.buy`, opened in a
   new tab with rel="noopener noreferrer". Do NOT build a cart, checkout form, or
   payment UI — Getly's checkout handles payment (card + crypto) and file delivery.
3. SAFETY: render all API strings (names, descriptions, alt text) as TEXT. Never
   inject them with innerHTML / dangerouslySetInnerHTML.
4. STATES: implement all four — loading (skeleton cards), error ("Couldn't load
   products" + retry button), empty ("No products yet"), and the populated grid.
5. The response envelope is `{ success, data }` — read products from
   `json.data.items`, the store name from `json.data.store.name`.
6. If `nextCursor` is non-null, show a "Load more" button that refetches with
   `&cursor=<nextCursor>` and appends the new items.
7. The endpoint is rate-limited (60 req/min per IP) and CDN-cached ~5 minutes —
   fetch once on load, don't poll.

## Page design

- Hero: store name (from the API), a one-line tagline I can edit, and a subtle
  gradient or pattern background.
- Product grid: responsive cards (2 col mobile → 4 col desktop) with image
  (lazy-loaded, 4:3, graceful placeholder when `images` is empty), name,
  shortDescription (2-line clamp), star rating with reviewCount (hide when
  reviewCount is 0), price, and a prominent Buy button.
- Footer: "Powered by Getly" linking to https://www.getly.store.
- Clean modern aesthetic, dark-mode friendly, accessible (semantic headings, alt
  text from `images[0].altText`, keyboard-focusable buttons).
````

---

## After it generates

- **Wrong slug?** A 404 means the slug doesn't match — copy it exactly from
  `getly.store/store/<slug>`.
- **Empty grid?** Only **published (active)** products appear. Publish drafts first —
  from your dashboard or via `getly.products.publish()` /
  the `publish_product` MCP tool.
- **Just published, not showing?** The endpoint is CDN-cached for ~5 minutes.
- **Want coupons, chat-based selling or sale notifications?** That's the
  authenticated API (checkout links + webhooks) — server-side only, see
  [`@getly/sdk`](../packages/sdk-js) and never expose an API key in generated
  client code.
