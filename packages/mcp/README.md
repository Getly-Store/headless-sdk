# @getly/mcp

MCP server that lets Claude, Cursor, Windsurf and any other [Model Context Protocol](https://modelcontextprotocol.io) client run your [Getly](https://www.getly.store) digital-products store: create and publish products, upload files, write blog posts, mint coupons and instant checkout links, inspect licenses and sales — all from chat.

```bash
npx @getly/mcp init   # guided setup for Claude Code / Cursor / Claude Desktop / Windsurf
```

## Prerequisites

1. A Getly account with a store (free): https://www.getly.store/sell
2. An API key: https://www.getly.store/dashboard/developer/keys — grant **only the scopes you need** (see [Security](#security)).

The key is read from the `GETLY_API_KEY` environment variable — the server never accepts keys as tool arguments and never prints them.

## Install & configure

### Claude Code

```bash
claude mcp add getly --env GETLY_API_KEY=YOUR_GETLY_API_KEY -- npx -y @getly/mcp
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "getly": {
      "command": "npx",
      "args": ["-y", "@getly/mcp"],
      "env": { "GETLY_API_KEY": "YOUR_GETLY_API_KEY" }
    }
  }
}
```

### Claude Desktop

Same JSON as Cursor, in:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

### Windsurf (`~/.codeium/windsurf/mcp_config.json`)

Same JSON as Cursor.

### Smithery

The repo ships a root `smithery.yaml`; the hosted config asks for `getlyApiKey` and maps it to `GETLY_API_KEY`.

> `npx @getly/mcp init` detects installed clients and offers to write these files for you (merging safely with existing config). `init --print` only prints the snippets.

## Tools (27)

| Tool | What it does | Hints / gates |
|---|---|---|
| `list_products` | List store products (cursor-paginated, filters) | read-only |
| `get_product` | Full product detail (files, images, reviews, URLs) | read-only |
| `create_product` | Create a **draft** product (money = integer cents, optional `licenseType`) | 100/day cap |
| `update_product` | Edit name/price/description/images/tags/`licenseType` | idempotent; cannot publish/archive |
| `publish_product` | Make a draft publicly purchasable (needs a file, an image and a category) | **requires `confirm: true`** |
| `archive_product` | Remove a product from sale (soft delete) | **destructive, requires `confirm: true`** |
| `upload_product_file` | Upload a local file as the buyer download (≤2GB) | slow for large files |
| `upload_image` | Upload a local image, returns a URL for products/posts | ≤10MB |
| `create_blog_post` | Markdown blog post; `[product:slug]` embeds a buy card | 5/day cap |
| `list_blog_posts` | List posts | read-only |
| `create_coupon` | Percentage or fixed-cents discount | **50%+ requires `confirm: true`**; 30/day cap |
| `list_coupons` | List coupons | read-only |
| `create_checkout_link` | Instant pay link, coupon auto-applied | idempotent per (product, coupon, reference) |
| `get_checkout_link_status` | Poll a link: open / completed / expired | read-only |
| `list_licenses` | Issued license keys + activations | read-only |
| `get_sales_stats` | Revenue (cents), sales, per-month breakdown, recent orders | read-only |
| `list_orders` | Sold order items with product, seller amount and the **buyer's email** | read-only; `read:orders` |
| `list_billing_plans` | Getly Billing plans (recurring prices for your own product) | read-only; `read:billing` |
| `create_billing_plan` | New plan: amount in cents every day/week/month/year × 1–52 | `write:billing`, approved application |
| `update_billing_plan` | Rename, reprice (new subscribers only) or deactivate a plan | idempotent |
| `create_billing_checkout` | Hosted subscribe page for one customer (24h), `customerRef` echoed on webhooks | `write:billing` |
| `list_billing_subscriptions` | Subscriptions, filter by status / customerRef / plan | read-only |
| `get_billing_subscription` | The access check: active and past_due are entitled | read-only |
| `cancel_billing_subscription` | Stop renewal at the end of the paid period | **destructive, requires `confirm: true`** |
| `search_categories` | Fuzzy search of the public 700+ category tree | read-only, no key needed, cached 1h |
| `get_store` | Store profile + public URL | read-only |
| `get_pay_widget_code` | Embed snippet for a Buy button on the user's own site | read-only |

**Timed access.** `create_product` and `update_product` accept `accessMode: "timed"` and `accessTerms` (durationDays, priceCents, optional compareAtPriceCents / label / isActive) to sell access for a period on a one-time payment — no recurring billing. On update the array replaces the table: rows with an `id` are updated, rows left out are retired. The store's webhook endpoint receives `access.expiring` (7 days before the end) and `access.expired`.

**Getly Billing.** The billing tools sell recurring access to the user's *own* product (a SaaS, community or tool on their site) — not a catalogue listing. Writes need an approved Billing application (`billing_not_approved` until the user applies at `/dashboard/billing`). Subscribers pay with PayPal or USDT/USDC today (one payment buys one period) or by card when that rail is live.

**Payments today.** Buyers pay with PayPal or USDT/USDC; card checkout is paused. Seller payouts are USDT/USDC on BNB Smart Chain (min $5) or USDT on Tron (min $15), on the 1st and 15th.

There is intentionally **no bulk-delete tool**, and the model is instructed to get explicit human approval before any confirm-gated call.

## Security

- **Least-privilege scopes.** Create separate keys per workflow:
  - Catalog management: `read:products`, `write:products`
  - Blogging: `read:posts`, `write:posts` (+ `write:products` for image uploads)
  - Sales bot: `checkout:create`, `read:coupons` (+ `write:coupons` if it mints discounts)
  - Reporting: `read:analytics`, `read:orders`, `read:store`, `read:licenses`
  - Subscriptions for your own product: `read:billing`, `write:billing`
- **Plaintext config warning.** MCP client config files store `GETLY_API_KEY` in plaintext on your machine. Anyone with access to those files can act on your store. Prefer per-machine keys.
- **Rotate / revoke** any key you suspect leaked at https://www.getly.store/dashboard/developer/keys (rotation keeps the old token valid for 24h so configs don't break mid-swap).
- The key never leaves the `Authorization` header of requests to `www.getly.store`; the server never logs or echoes it (setup output masks all but the last 4 characters).

## Programmatic use

```ts
import { createGetlyMcpServer } from '@getly/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createGetlyMcpServer();
await server.connect(new StdioServerTransport());
```

## Development

```bash
npm -w packages/mcp run typecheck
npm -w packages/mcp run build
npm -w packages/mcp test        # includes a real stdio boot test
```

MIT © Getly
