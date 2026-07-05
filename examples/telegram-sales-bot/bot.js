/**
 * Getly Telegram sales bot — a complete store inside a chat.
 *
 * Flow:
 *   /catalog                 → lists the store's active products (public API, no key needed)
 *   tap a product button     → bot creates a checkout link (reference = chat id) and replies
 *                              with the pay URL — buyer pays by card, no Getly account needed
 *   every 30s (polling loop) → bot checks each active link's status; on `completed` it
 *                              messages the chat that payment arrived
 *
 * This runs on a laptop with NO public URL — no webhooks required. See the
 * "webhook upgrade path" comment at the bottom for the production version.
 *
 * Security: the API key comes ONLY from the GETLY_API_KEY env var. Never pass
 * keys as CLI args and never log them.
 */

import { Bot, InlineKeyboard } from 'grammy';
import { Getly } from '@getly/sdk';

// ---------------------------------------------------------------------------
// Config — all from env. Copy .env.example to .env and `node --env-file=.env bot.js`
// (Node 20+) or export the vars in your shell.
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.BOT_TOKEN;
const STORE_SLUG = process.env.STORE_SLUG;

if (!BOT_TOKEN) fail('BOT_TOKEN is not set (get one from @BotFather on Telegram)');
if (!STORE_SLUG) fail('STORE_SLUG is not set (your store slug, e.g. "neon-ui" from getly.store/store/neon-ui)');
if (!process.env.GETLY_API_KEY) {
  fail('GETLY_API_KEY is not set (create a key with the checkout:create scope at getly.store/dashboard/developer/keys)');
}

function fail(msg) {
  console.error(`Config error: ${msg}`);
  process.exit(1);
}

// The SDK reads GETLY_API_KEY from the environment — we never touch the key here.
const getly = new Getly();
const bot = new Bot(BOT_TOKEN);

// ---------------------------------------------------------------------------
// Payment polling (webhook-free mode)
//
// activeLinks: linkId -> { chatId, productName, watchedSince }
// Every POLL_INTERVAL_MS we ask GET /api/v1/checkout-links/{id} for each
// watched link (that endpoint exists exactly for bots without a public URL;
// it is rate-limited at 120 req/min per key, so 30s polling leaves lots of
// headroom even with dozens of open links).
// A link is watched for at most WATCH_TTL_MS — after that the buyer clearly
// walked away and we stop spending requests on it. The link itself stays
// valid for 7 days; if the buyer pays later the sale still completes, we just
// don't announce it in chat.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const WATCH_TTL_MS = 20 * 60_000; // stop watching a link after 20 minutes

/** @type {Map<string, { chatId: number, productName: string, watchedSince: number }>} */
const activeLinks = new Map();

async function pollActiveLinks() {
  const now = Date.now();
  for (const [linkId, watch] of activeLinks) {
    if (now - watch.watchedSince > WATCH_TTL_MS) {
      activeLinks.delete(linkId);
      continue;
    }
    try {
      const link = await getly.checkoutLinks.get(linkId);
      if (link.status === 'completed') {
        activeLinks.delete(linkId);
        await bot.api.sendMessage(
          watch.chatId,
          `✅ Payment received for “${watch.productName}” — check your email for the download link!`,
        );
      } else if (link.status === 'expired') {
        activeLinks.delete(linkId);
      }
      // status 'open' → keep watching
    } catch (err) {
      // Transient API/network errors: keep the link in the map, try next tick.
      console.error(`Poll failed for link ${linkId}: ${err && err.message ? err.message : err}`);
    }
  }
}

setInterval(pollActiveLinks, POLL_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** All Getly money is integer cents — divide by 100 exactly once, at display time. */
function formatPrice(priceCents, currency) {
  if (currency && currency !== 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(priceCents / 100);
  }
  return usd.format(priceCents / 100);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

bot.command('start', (ctx) =>
  ctx.reply(
    'Hi! I sell digital products right here in the chat.\n\n' +
      '/catalog — see what’s available\n\n' +
      'Payment is by card via Getly; your files arrive by email right after checkout.',
  ),
);

bot.command('catalog', async (ctx) => {
  try {
    // Public endpoint — lists active products of the store. No auth involved.
    const { items } = await getly.publicStore.products(STORE_SLUG, { limit: 10 });

    if (!items || items.length === 0) {
      await ctx.reply('The store has no products yet — check back soon!');
      return;
    }

    const keyboard = new InlineKeyboard();
    const lines = [];
    for (const product of items) {
      lines.push(`• ${product.name} — ${formatPrice(product.priceCents, product.currency)}`);
      // callback_data is limited to 64 bytes; "buy:" + uuid = 40 bytes. Safe.
      keyboard.text(`${product.name} · ${formatPrice(product.priceCents, product.currency)}`, `buy:${product.id}`).row();
    }

    await ctx.reply(`🛍 Catalog:\n\n${lines.join('\n')}\n\nTap a product to get a payment link:`, {
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error('Catalog fetch failed:', err && err.message ? err.message : err);
    await ctx.reply('Couldn’t load the catalog right now — please try again in a minute.');
  }
});

// ---------------------------------------------------------------------------
// Buy button → checkout link
// ---------------------------------------------------------------------------

bot.callbackQuery(/^buy:([0-9a-f-]{36})$/i, async (ctx) => {
  const productId = ctx.match[1];
  const chatId = ctx.chat?.id ?? ctx.callbackQuery.from.id;

  try {
    // reference = chat id: it comes back in checkout-link status responses and
    // in the sale.completed webhook payload, so a payment is always traceable
    // to the exact conversation that produced it.
    //
    // Creating the same (product, reference) link twice returns the SAME open
    // link instead of minting a new row — safe to tap the button repeatedly.
    const link = await getly.checkoutLinks.create({
      productId,
      reference: String(chatId),
    });

    // Find the product name for nicer messages (fall back to a generic label).
    let productName = 'your product';
    try {
      const { items } = await getly.publicStore.products(STORE_SLUG, { limit: 100 });
      const match = items.find((p) => p.id === productId);
      if (match) productName = match.name;
    } catch {
      /* cosmetic only */
    }

    activeLinks.set(link.id, { chatId, productName, watchedSince: Date.now() });

    const price = formatPrice(link.discountedPriceCents ?? link.priceCents, link.currency);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `💳 Pay ${price} for “${productName}”:\n${link.url}\n\n` +
        'The link is valid for 7 days. Your download arrives by email right after payment — ' +
        'no account needed. I’ll confirm here once the payment lands.',
    );
  } catch (err) {
    console.error('Checkout link creation failed:', err && err.message ? err.message : err);
    await ctx.answerCallbackQuery({ text: 'Something went wrong — try again.', show_alert: true });
  }
});

bot.catch((err) => {
  console.error('Bot error:', err.message);
});

bot.start();
console.log('Bot is running. Send /catalog to it on Telegram.');

// ---------------------------------------------------------------------------
// Webhook upgrade path (when you deploy this somewhere with a public URL)
//
// Polling is perfect for a laptop, but in production you'd rather be TOLD
// about payments than ask every 30 seconds:
//
//   1. Deploy a tiny Next.js app and add the @getly/nextjs webhook handler:
//
//        // app/api/getly/webhooks/route.ts
//        import { Webhooks } from '@getly/nextjs';
//        export const POST = Webhooks({
//          secret: process.env.GETLY_WEBHOOK_SECRET,
//          onCheckoutLinkCompleted: async (data) => {
//            // data.reference is the Telegram chat id we set above
//            await bot.api.sendMessage(Number(data.reference),
//              '✅ Payment received — check your email for the download link!');
//          },
//        });
//
//   2. Register the endpoint (scope webhooks:manage) for the
//      `checkout_link.completed` event — via the dashboard or
//      POST /api/v1/webhook-endpoints.
//
//   3. Delete the polling loop above. Signatures are verified for you
//      (X-Getly-Signature-V2, timestamped HMAC, 5-minute tolerance).
// ---------------------------------------------------------------------------
