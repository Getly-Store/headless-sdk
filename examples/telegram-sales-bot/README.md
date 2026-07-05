# Telegram sales bot

Sell your Getly products inside a Telegram chat. Buyers browse the catalog, tap a
product, get a payment link, pay by card — and the bot confirms the sale in the chat.

Runs on a laptop. No server, no public URL, no webhooks — a small polling loop
(one status request per open link every 30 seconds) does the job.

```
you:  /catalog
bot:  🛍 Catalog:
      • Neon UI Kit — $19.00
      [ Neon UI Kit · $19.00 ]      ← inline button
you:  *tap*
bot:  💳 Pay $19.00 for “Neon UI Kit”: https://www.getly.store/go/…
      …buyer pays…
bot:  ✅ Payment received for “Neon UI Kit” — check your email for the download link!
```

## How buyers receive files (honest note)

Getly checkout links use **guest checkout**: Stripe collects the buyer's email during
payment, and Getly emails the download link to that address. The buyer does **not**
need a Getly account, and the bot never sees or handles the files. So "check your
email" is literal — that's where the product arrives.

## 15-minute setup

**Minute 0–2 — create the bot.**
Open [@BotFather](https://t.me/BotFather) in Telegram → `/newbot` → pick a name and a
username. Copy the token it gives you.

**Minute 2–5 — get a Getly API key.**
Go to [getly.store/dashboard/developer/keys](https://www.getly.store/dashboard/developer/keys)
(sign up first if needed — Google/GitHub/email, ~1 minute). Create a key with the
**`checkout:create`** scope. That is the only scope this bot needs — principle of
least privilege. Copy the key (`getly_sk_live_…`); it is shown once.

**Minute 5–7 — find your store slug.**
Your storefront lives at `https://www.getly.store/store/<slug>` — the `<slug>` part is
what you need. No store yet? Create one and publish at least one product (or run
[`npx @getly/auto-store ./your-folder`](../../packages/auto-store) and let your AI do it).

**Minute 7–10 — configure and install.**

```bash
cd examples/telegram-sales-bot
cp .env.example .env
# fill in BOT_TOKEN, GETLY_API_KEY, STORE_SLUG in .env
npm install
```

**Minute 10–11 — run it.**

```bash
node --env-file=.env bot.js        # Node 20+
# or: export the three vars in your shell, then: npm start
```

**Minute 11–15 — try it.**
Open your bot in Telegram, send `/catalog`, tap a product, open the link, pay
(use your own product priced at $1 for a live test — Getly has no test mode yet).
Within ~30 seconds of paying, the bot posts the confirmation in the chat.

## How it works

| Piece | What it uses |
| --- | --- |
| `/catalog` | `getly.publicStore.products(STORE_SLUG)` → the **public** store endpoint (no auth, CDN-cached ~5 min — a just-published product can take a few minutes to appear) |
| Buy button | `getly.checkoutLinks.create({ productId, reference: chatId })` → returns `{ url, priceCents, … }`. `reference` ties the payment back to the chat. Creating the same link twice returns the same open link — tapping the button repeatedly is safe. |
| Payment detection | `getly.checkoutLinks.get(id)` every 30s per open link, for max 20 minutes per link (`GET /api/v1/checkout-links/{id}` exists exactly for bots without a public URL) |

All prices are **integer cents** (`priceCents`) — the bot divides by 100 exactly once,
at display time, with `Intl.NumberFormat`.

## Production upgrade: webhooks instead of polling

Once you deploy anywhere with a public URL, replace the polling loop with the
`checkout_link.completed` webhook — see the commented block at the bottom of
[`bot.js`](./bot.js). The short version: `Webhooks()` from `@getly/nextjs` verifies the
timestamped `X-Getly-Signature-V2` header for you and hands you the event with the
`reference` (your chat id) attached.

## Security notes

- The API key is read from `GETLY_API_KEY` **only**. Never pass it as a CLI argument
  (shell history, process lists) and never log it.
- Give the key only `checkout:create`. If it leaks, the worst an attacker can do is
  create payment links **to your own products** — they cannot read orders or edit anything.
- `.env` is for local use; on a server use your platform's secret store.
