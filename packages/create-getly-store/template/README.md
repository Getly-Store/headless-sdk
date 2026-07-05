# __APP_NAME__

A minimal Next.js storefront for the Getly store **`__STORE_SLUG__`**,
scaffolded with [`create-getly-store`](https://www.npmjs.com/package/create-getly-store).

It renders your store's **active products** from Getly's public API — no API
key, no database, no server secrets:

- `GET /api/v1/public/stores/__STORE_SLUG__/products` — catalog grid (`app/page.tsx`)
- `GET /api/v1/public/stores/__STORE_SLUG__/products/{slug}` — product page (`app/p/[slug]/page.tsx`)

Pages are server-rendered with `revalidate: 300` (5 minutes — the same cache
the API itself serves), all prices are integer cents formatted with `Intl`,
and the **Buy** button sends visitors to Getly's hosted checkout (`urls.buy`).
Dark/light theme follows the visitor's system preference. Styling is plain
hand-written CSS in `app/globals.css` — no component libraries.

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

## Point it at a different store

The store slug lives in `getly.config.json`. An env var overrides it without
touching code — copy `.env.local.example` to `.env.local` and edit:

```bash
NEXT_PUBLIC_GETLY_STORE_SLUG=your-store-slug
```

Your slug is the part after `getly.store/store/` on your public store page.

## Deploy

This folder is a complete, standalone Next.js app (a `vercel.json` is
included). Vercel's one-click **Deploy** button needs a Git repository URL to
clone, so the honest recipe is:

1. Push this folder to a GitHub repository:

   ```bash
   git init && git add -A && git commit -m "storefront"
   git remote add origin https://github.com/YOU/YOUR-REPO.git
   git push -u origin main
   ```

2. Import it at <https://vercel.com/new> (framework is auto-detected), **or**
   put a Deploy button in your repo's README pointing at itself:

   ```md
   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOU/YOUR-REPO)
   ```

3. Optionally set `NEXT_PUBLIC_GETLY_STORE_SLUG` in the Vercel project's
   environment variables to switch stores per deployment.

Any other Node 18+ host works too: `npm run build && npm start`.

## Files

```
app/
  layout.tsx        Shell + footer + metadata
  page.tsx          Product grid (public catalog endpoint)
  p/[slug]/page.tsx Product detail + Buy button
  globals.css       All styling (hand CSS, dark/light aware)
lib/
  config.ts         Store slug + API origin resolution
  getly.ts          Typed public-API helpers (cents → Intl formatting)
getly.config.json   The store this storefront renders
vercel.json         Framework hint for Vercel
```
