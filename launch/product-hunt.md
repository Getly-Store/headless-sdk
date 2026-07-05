# Product Hunt launch — Getly Headless SDK

> Second Getly launch on PH. The first (the marketplace itself) went live 2026-04-28:
> producthunt.com/products/getly. This one launches the **SDK/MCP layer** as its own
> product under the same PH product page (new launch). Schedule 00:01 PT, Tuesday–Thursday.

## Name

**Getly Headless SDK**

## Tagline (≤60 chars)

Primary (52 chars):

> Give your AI an API key. Get back a running store.

Alternates:

- `Your AI assistant can now run a digital-products store` (55)
- `Headless commerce for vibe coders — SDK, MCP, one npx` (54)

## Description

> Getly Headless SDK turns Getly — a digital-products marketplace with card + crypto
> checkout, file delivery, license keys and payouts — into a backend your AI
> assistant drives directly. An MCP server with 16 tools puts the store inside
> Cursor, Claude Code and Claude Desktop; a zero-dependency TypeScript SDK covers
> products, blog posts, coupons, checkout links and licenses; and
> `npx @getly/auto-store ./folder` points AI at a folder of files and comes back
> with a published product, a blog post and a pay link. Open source, MIT.

## Topics

`Developer Tools` · `APIs` · `Artificial Intelligence` · `E-commerce` · `Open Source`

## First comment (maker comment) — draft

> Hey PH! 👋
>
> We launched Getly here a couple of months ago as a digital-goods marketplace.
> Since then we kept noticing the same thing: the people uploading products were
> increasingly *not* opening the dashboard — they were asking Cursor or Claude to
> do it, and the AI had nothing to hold on to.
>
> So we built the layer the AI needs:
>
> 🤖 **@getly/mcp** — 16 MCP tools. "Create a product from this folder, price it
> $19, write the listing, publish it" now works in Cursor / Claude Code / Claude
> Desktop. Destructive actions require explicit confirmation; the key comes from
> env only.
>
> 📦 **@getly/sdk** — zero-dependency TypeScript client. Money is always integer
> cents, every error carries a machine-readable code + a hint written for LLMs,
> idempotency keys are automatic on creates.
>
> ⚡ **npx @getly/auto-store ./my-icon-pack** — the party trick. Claude reads the
> folder, writes an honest listing + an SEO article, uploads files (up to 2GB),
> publishes, and hands you a checkout link that takes cards and USDT/USDC.
> `--dry-run` shows the plan first.
>
> Honest bits, because PH comments deserve them:
> - Three steps still need a human: creating the account, generating the API key,
>   and connecting payouts (Stripe/crypto). Everything after that is API.
> - New stores' API-created products go through moderation before going live.
> - Fees: 20% all-in (sellers keep 90% their first 3 months). No monthly fee.
>
> Everything is MIT on GitHub — the OpenAPI spec, the MCP server, a Telegram
> sales-bot example, an embeddable storefront widget. Ask us anything, and if you
> try `auto-store --dry-run` on a real folder, post what it planned — best answer
> to "what did your AI try to sell" gets a spotlight in our SHOWCASE.md.

## Gallery shot-list (1270×760, first image = the hook)

1. **Hero card** — dark background, the one-liner `npx @getly/auto-store ./my-icon-pack`
   in a big terminal frame, tagline underneath. (This is the thumbnail — no clutter.)
2. **Terminal GIF/video** — real `auto-store` run: folder scan → "writing listing…" →
   "uploading 3 files…" → "published ✓" → checkout-link URL printed. ~25s loop.
3. **MCP in Cursor** — split screen: chat says "publish the draft and give me a 20%-off
   link for the newsletter", right side shows the tool calls + the resulting link.
4. **Code snippet card** — the 5-line "sell your first product" SDK snippet with
   `priceCents: 1900` highlighted.
5. **Telegram bot** — phone-frame screenshot of the /catalog → buy → "Payment
   received" flow (examples/telegram-sales-bot).
6. **Fee/honesty card** — the "what Getly handles vs what you own" table: checkout,
   files, licenses, payouts vs pricing, content, taxes-as-a-seller.

## Launch-day checklist

- [ ] `@getly` packages live on npm with provenance (founder action — see CONTRIBUTING)
- [ ] README demo GIF replaced with the real recording (no placeholder on launch day)
- [ ] `getly.store/developers` live and linked from the PH description
- [ ] MCP registry listings live (see registries.md) so "install via Smithery" works
- [ ] Maker + at least one teammate available in comments for the first 6 hours
- [ ] Reply template for "how is this different from Gumroad/Lemon Squeezy": we're
      API-first for AI agents (MCP), crypto payouts, guest checkout — and honest
      about the 3 manual steps
