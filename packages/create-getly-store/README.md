# create-getly-store

Scaffold a minimal, beautiful Next.js storefront for your
[Getly](https://www.getly.store) store — one command, zero dependencies in the
scaffolder itself:

```bash
npx create-getly-store my-store --store your-store-slug
cd my-store
npm install
npm run dev        # http://localhost:3000
```

Omit `--store` and you'll be prompted. The slug is the part after
`getly.store/store/` on your public store page.

## What you get

A complete Next.js 15 App Router app (React 19, TypeScript, strict) that
renders your store's active products from Getly's **public** storefront API —
no API key, no database:

- **Catalog grid** (`app/page.tsx`) — `GET /api/v1/public/stores/{slug}/products`,
  server-fetched with `revalidate: 300`.
- **Product pages** (`app/p/[slug]/page.tsx`) — single-product endpoint with
  description, gallery and metadata.
- **Buy button** → Getly's hosted checkout (`urls.buy`); files are delivered
  by Getly after payment.
- **Money done right** — the template reads only `priceCents` (integer cents)
  and formats with `Intl.NumberFormat`.
- **Dark/light** via `prefers-color-scheme`; styling is tasteful hand-written
  CSS (`app/globals.css`), no component libraries.

## Configuration

The store slug is written into two places at scaffold time:

- `getly.config.json` — the committed default;
- `.env.local.example` — copy to `.env.local` (or set on your host) as
  `NEXT_PUBLIC_GETLY_STORE_SLUG` to override without code changes.

## Deploy

The generated `README.md` documents the honest path: push the folder to a
GitHub repository, then import it at <https://vercel.com/new> (a `vercel.json`
is included) — or add Vercel's Deploy button to *your* repo pointing at
itself. A one-click clone URL can only point at a repo you control, so the
scaffolder doesn't pretend otherwise.

## Safety notes

- The scaffolder **refuses to write into a non-empty directory** — it never
  overwrites existing files.
- The template never injects seller-provided HTML (descriptions are stripped
  to plain paragraphs — no `dangerouslySetInnerHTML`).

## License

MIT
