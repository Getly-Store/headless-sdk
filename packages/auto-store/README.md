# @getly/auto-store

Point AI at a folder — get a store.

`getly-auto-store` scans a local folder of digital goods, has Claude draft an
honest product listing plus a companion blog article, then creates everything
on [Getly](https://www.getly.store) through the public v1 API: images, the
downloadable files, the (moderation-aware) publish, a published blog post that
embeds the product, and a shareable checkout link.

## Start with a dry run

It costs nothing and **writes nothing** — the only network call is a public
`GET /api/categories`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...       # https://platform.claude.com/settings/keys
npx @getly/auto-store ./my-icon-pack --dry-run
```

You'll see the drafted listing (name, price, tags, description, blog article)
and the exact plan of what a real run would create.

## Go live

```bash
export GETLY_API_KEY=getly_sk_live_...    # https://www.getly.store/dashboard/developer/keys
npx @getly/auto-store ./my-icon-pack
```

```
Scanning ./my-icon-pack ...
Found 9 files (4 images, 5 downloadable).
Drafting listing with claude-sonnet-5 ...
Category: "icons" → Icons & UI Elements (icons-ui-elements)
...
Create "Minimal Icon Pack" on https://www.getly.store? [y/N] y
  ↑ image preview.png
Created draft product: Minimal Icon Pack (7d1f...)
  ↑ file pack.zip
✔ Product is LIVE: https://www.getly.store/product/minimal-icon-pack-k3x9
✔ Blog post published: https://www.getly.store/store/my-store/posts/designing-a-minimal-icon-set
✔ Checkout link: https://www.getly.store/go/1a2b3c...
```

## What it does, step by step

1. **Scan** — file names, sizes, extensions; the first 2KB of up to 3 text
   files as drafting context. Images become the product gallery (first 5);
   every non-image file becomes a downloadable (up to 10, uploaded
   individually — zip the folder yourself first if you want one download).
2. **Draft** — one Claude call with a single strict `draft_listing` tool and a
   forced tool choice, so the output is schema-validated JSON (no fence
   parsing). Honesty is part of the prompt: it may only describe what the
   scan evidences.
3. **Category** — the free-text category is fuzzy-matched against the public
   category tree; if nothing matches, it falls back to a sensible parent
   category *and tells you so*.
4. **Create** — draft product with `priceCents` (integer cents — the API's
   money convention), tags and gallery. The create is **idempotent**: the
   `Idempotency-Key` is derived from the folder path + name, so re-running
   after a crash replays instead of duplicating.
5. **Publish** — via `POST /products/{id}/publish`. If the marketplace queues
   the product for review (new stores are), the CLI says **"awaiting review —
   NOT live yet"**; it never pretends. If publish is blocked, every
   machine-readable reason is printed.
6. **Blog post** — published with the article's `[product:<real-slug>]` embed
   so the product card renders inside the post.
7. **Checkout link** — created only once the product is actually live.

## Flags

| Flag | Meaning |
| --- | --- |
| `--dry-run` | Draft + plan only. Zero writes. |
| `--publish` / `--no-publish` | Publish after upload (default) / keep as draft. |
| `--price-cents <n>` | Override the AI-suggested price (integer cents). |
| `--model <id>` | Claude model (default `claude-sonnet-5`). |
| `--yes`, `-y` | Skip the confirmation prompt. |

## Environment

| Variable | Purpose |
| --- | --- |
| `GETLY_API_KEY` | Getly API key (`getly_sk_live_...`). Scopes: `write:products`, `write:posts`, `checkout:create`. Create at <https://www.getly.store/dashboard/developer/keys>. |
| `ANTHROPIC_API_KEY` | Anthropic API key. Create at <https://platform.claude.com/settings/keys>. |
| `GETLY_API_URL` | Optional base-URL override (default `https://www.getly.store`). |

Keys are read from the environment **only** — the CLI rejects `--api-key`-style
arguments and never prints key material.

## Programmatic use

All v1 API traffic runs through [`@getly/sdk`](https://www.npmjs.com/package/@getly/sdk)
(re-exported here), which handles Bearer auth, the `{ success, data }`
envelope, integer-cents money, Idempotency-Keys and 429 retries.

```ts
import runAutoStore, { Getly } from '@getly/auto-store';
import Anthropic from '@anthropic-ai/sdk';

const result = await runAutoStore(
  { folder: './my-icon-pack', dryRun: true },
  {
    getly: new Getly(), // reads GETLY_API_KEY from the environment
    anthropic: new Anthropic() as never,
    log: console.log,
    confirm: async () => true,
  },
);
```

## License

MIT
