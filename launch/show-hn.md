# Show HN — Getly Headless SDK

> Post 8–11am ET, Tuesday–Thursday. Plain text, no marketing tone — HN reads
> everything as a claim to be audited. Every statement below is technically checkable
> against the public repo.

## Title options (≤80 chars)

1. `Show HN: I gave my AI assistant an API key and it opened a store`
2. `Show HN: MCP server + SDK that lets Claude/Cursor run a digital-products store`
3. `Show HN: npx auto-store – point AI at a folder, get a published product`

Option 1 is the strongest hook; keep 2 as the fallback if the mods ask for something
more literal.

## Post body

```
Hi HN. I run Getly, a small digital-products marketplace (templates, fonts, code,
audio). Over the past few months I watched sellers stop opening the dashboard —
they ask Cursor or Claude to "put this icon pack up for sale" and the AI has no
way to actually do it. So I built the missing layer and open-sourced it (MIT):

https://github.com/Getly-Store/headless-sdk

What's in the repo:

- @getly/mcp — an MCP server with 16 tools (products CRUD + file upload +
  publish, blog posts, coupons, checkout links, license keys, sales stats).
  Works in Claude Code / Claude Desktop / Cursor. Destructive tools require an
  explicit confirm:true argument; there is deliberately no bulk-delete tool; the
  API key is read from env only, never from tool arguments.

- @getly/sdk — zero-dependency TypeScript client. Design choices that came from
  watching LLMs use APIs badly: all money is integer cents (no floats, no
  dollar strings), every error has a stable machine-readable code plus a "hint"
  field that tells the agent what to do next, Idempotency-Key is set
  automatically on creates, and the client backs off proactively from
  X-RateLimit-Remaining instead of slamming into 429s.

- npx @getly/auto-store ./folder — the demo that started this. Claude reads the
  folder, writes the listing and a blog post, uploads the files, creates the
  product and publishes. --dry-run prints the plan without writing anything.

- Checkout links: POST /v1/checkout-links gives a URL a bot can drop into any
  chat; `reference` (e.g. a Telegram chat id) is echoed back in the webhook, and
  there's a polling endpoint for bots without a public URL. The Stripe session
  is created lazily at click time, not at link creation — that plus per-IP
  velocity limits is the card-testing defense. There's a grammY example bot in
  examples/.

- Webhooks are signed with a timestamped HMAC (t=...,v1=..., 5-min tolerance),
  Stripe-style, so replays are detectable.

Honest limitations, so nobody discovers them in the comments first:

- Three steps are still manual: account signup, API key creation, payout
  onboarding (Stripe Connect or a crypto wallet). Everything after is API.
- API-created products from brand-new stores go through moderation before they
  are publicly visible. The API tells you this honestly instead of pretending
  the product is live.
- No test mode yet — the recommended way to test the money path is a $1 product
  of your own. On the roadmap.
- The marketplace takes 20% (sellers keep 90% for the first 3 months). That's
  the business model; the SDK/MCP layer itself is MIT and free.

The part I'd most like feedback on: the error-envelope-for-LLMs idea (code +
hint + docsUrl on every error) and whether the MCP confirm:true convention is
enough friction for destructive operations, or whether agents just cargo-cult
the confirmation. Happy to answer anything.
```

## Prepared answers for predictable questions

- **"Why not just Stripe?"** — Stripe gives you payments; you still own file
  delivery, license keys, receipts, refunds, payout scheduling, and a storefront.
  This gives an agent all of it behind one key. If you want to build that on raw
  Stripe, genuinely, go for it — this is for people who don't.
- **"AI listing spam?"** — new API-born stores are moderated before anything is
  public; per-key creation caps (20 products/day); provenance (`created_via=api`)
  is stored and visible to admins.
- **"Why should the AI hold a key that can create discounts?"** — scopes. A bot key
  with `checkout:create` alone cannot read orders or touch products. Coupons ≥90%
  additionally require an explicit acknowledgment flag.
- **"MoR / taxes?"** — Getly is not a merchant of record today. The docs have a
  "what Getly handles vs what you own" table instead of hiding this.
- **"Is the platform itself open source?"** — no, the platform is a hosted service;
  the SDK, MCP server, OpenAPI spec and examples are MIT.
