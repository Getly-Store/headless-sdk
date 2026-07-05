# Template-gallery submission plan — v0 / Lovable / Bolt / Replit

Strategy: meet vibe coders where they already generate apps. Each gallery gets a
**working storefront template** backed by the public Getly endpoint (no API key in
any template — public endpoints only), plus a link chain back to the repo and
`getly.store/developers`.

Common asset for all four: a demo store (`demo-store` slug, owned by us, 8 real-looking
products with images) so every template renders a full grid out of the box. Keep it
stocked — an empty demo store kills every gallery at once.

## 1. v0 (v0.dev community)

- **What:** publish the generation from `docs/v0-lovable-prompt.md` as a public v0
  project/template titled "Digital products storefront (Getly)".
- **How:** run the prompt in v0, iterate until the 4 states (loading/error/empty/grid)
  all render, hit Publish → community. Description = the prompt file's contract
  summary + repo link.
- **Success bar before publishing:** Lighthouse a11y ≥ 90, mobile grid 2-col, prices
  formatted from `priceCents` (spot-check $19.00, not $1900 — the classic cents bug).
- **Also:** the shadcn-style snippets in `docs/react-snippets.md` are v0-pasteable;
  mention that in the template description.

## 2. Lovable (lovable.dev — Launched/templates gallery)

- **What:** a slightly fuller app — storefront + product detail page (the second
  public endpoint) + "About" page.
- **How:** build in Lovable from the same prompt + one follow-up ("add a product
  detail route using GET …/products/{productSlug}"), publish to their gallery/
  Launched. Remix-able set to ON — remixes are the whole point.
- **Copy:** "Your Getly store as a website — remix, swap the store slug, deploy."

## 3. Bolt (bolt.new gallery / StackBlitz)

- **What:** same storefront as a Vite + React project (Bolt's home turf).
- **How:** generate in Bolt, verify, then also pin the project as a StackBlitz link
  in the repo README ("Open in StackBlitz" badge on `docs/react-snippets.md`).
- **Note:** Bolt gallery submission is via their community showcase (Discord/X form
  as of mid-2026 — verify current flow on submission day).

## 4. Replit (replit.com templates)

- **What:** two templates:
  1. **"Getly storefront"** — static HTML + the widget from
     `examples/storefront-widget` (zero-build, perfect for Replit's static hosting);
  2. **"Getly Telegram sales bot"** — `examples/telegram-sales-bot` adapted: env vars
     via Replit Secrets (BOT_TOKEN, GETLY_API_KEY, STORE_SLUG), Reserved-VM-friendly
     (long-running polling loop; note that free Repls sleep and break polling).
- **How:** create under the Getly org account, "Publish as template", category
  Web / Bots. Template README = shortened example READMEs with a "Secrets" setup
  section instead of `.env`.
- **Security note in the bot template description:** the API key goes in Replit
  Secrets, never in code — repls are public by default.

## Sequencing

1. Week 0 (launch week): v0 + Replit static (fastest approvals) live before the PH
   launch so the PH comments can link them.
2. Week 1: Lovable + Bolt + Replit bot template.
3. Week 2: add all gallery links to README + SHOWCASE.md + /developers; screenshot
   each for the docs.

## Maintenance rule

Templates embed the public endpoint contract. If `serializePublicProduct` ever adds
or renames fields, the templates keep working (additive), but any BREAKING change to
`items`/`urls`/`priceCents` requires updating all four galleries — add this to the
platform-side API-change checklist.
