# 60-second launch video — shot-by-shot script

**Subject:** one real, uncut-feeling run of `npx @getly/auto-store` — folder in,
selling product out. **Format:** screen recording (terminal + browser), 16:9 for
PH/YouTube, re-crop 9:16 for Shorts/Reels/TikTok. **Voice:** calm, matter-of-fact —
the footage is the hype. Record the terminal at 120×30, font ≥18pt, dark theme.

> Rule: every frame must be reproducible by a viewer with the repo. No mockups,
> no sped-up fake output. Time-compress waiting with hard cuts, not fake spinners.

| # | Time | Visual | VO / on-screen text |
|---|------|--------|---------------------|
| 1 | 0:00–0:04 | Finder/`ls` of a real folder: `icon-pack/` with 3 preview PNGs + `icons.zip` | VO: "This is a folder of icons I made." Text: `a folder ≠ a business` |
| 2 | 0:04–0:08 | Empty terminal. Type (real keystrokes): `npx @getly/auto-store ./icon-pack` | VO: "One command. My AI assistant does the rest." |
| 3 | 0:08–0:16 | Terminal output scrolls: `Scanning folder… found 1 archive, 3 images` → `Claude is writing your listing…` | VO: "Claude reads the files and writes the product listing — name, description, price suggestion, category." |
| 4 | 0:16–0:22 | Output: the generated listing preview block (name `Lineal Icon Pack — 240 icons`, `priceCents: 1200 → $12.00`, category) | VO: "Everything is reviewable before anything goes live — there's a dry-run mode too." Text: `--dry-run = plan only` |
| 5 | 0:22–0:30 | Output: `Uploading icons.zip (14 MB)… ✓` `Uploading 3 images… ✓` `Creating product… ✓` `Writing blog post… ✓` `Publishing… ✓` | VO: "It uploads the files, creates the product, writes a blog post that links to it, and publishes." |
| 6 | 0:30–0:38 | Final terminal lines: product URL + checkout-link URL printed. Cursor copies the product URL. | VO: "And hands back two URLs: the product page… and a payment link." |
| 7 | 0:38–0:46 | Browser: the LIVE product page on getly.store — images, price, Buy button. Scroll once, slowly. | VO: "This is live. Card and crypto checkout, file delivery, license keys, receipts — all handled." |
| 8 | 0:46–0:52 | Browser: click Buy → Stripe checkout sheet appears (stop before payment details). | VO: "Buyers don't even need an account — files arrive by email." |
| 9 | 0:52–0:57 | Cut back to terminal. Text overlay, three lines appearing one by one: `SDK · MCP · auto-store` / `zero-dep TypeScript` / `MIT on GitHub` | VO: "SDK, MCP server for Cursor and Claude, examples — all open source." |
| 10 | 0:57–1:00 | End card: repo URL `github.com/Getly-Store/headless-sdk` + `npx @getly/auto-store` | VO: "Give your AI an API key. Get back a running store." |

## Production notes

- **The one honest edit:** if the store is brand-new, publish reports "pending
  review". Either record with a trusted store so `Publishing… ✓` is real, or keep
  the honest `pending review — will go live after moderation` line in frame and
  adjust VO: "…and publishes — new stores get a quick review first." Do NOT fake ✓.
- Shot 8: never show a real card form being filled; stop at the sheet render.
- Captions burned in (80% of social viewers are muted).
- Keep the raw uncut recording — link it from the README for skeptics ("full
  unedited run: …"). That link does more than the edit.
- 9:16 recut: shots 1–6 terminal-only full-frame, shots 7–8 phone-width browser,
  drop shot 9, end card 3s.
