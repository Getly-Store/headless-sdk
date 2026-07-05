# MCP registry & directory submissions

Goal: `@getly/mcp` discoverable everywhere people look for MCP servers.
**Prerequisites for ALL entries:** `@getly/mcp` published to npm (with provenance),
repo public, `smithery.yaml` present in `packages/mcp`, README section for the server.

> Registry submission flows change; the steps below are correct as of July 2026 —
> re-verify each site's docs on submission day. Track status in the checklist at
> the bottom.

## Shared listing copy (adapt lengths per site)

**Name:** Getly
**One-liner:** `Run a digital-products store from your AI assistant — products, checkout links, coupons, license keys.`
**Description (long):**

> Getly MCP server gives your assistant a real commerce backend: create and publish
> digital products (with file upload), write store blog posts, mint coupons and
> instant checkout links (card + USDT/USDC via guest checkout), manage license keys
> and read sales stats. 16 tools with MCP annotations; destructive operations
> require explicit confirmation; the API key is read from the `GETLY_API_KEY` env
> var only. MIT, zero telemetry.

**Install snippet:**

```bash
claude mcp add getly --env GETLY_API_KEY=your_key -- npx -y @getly/mcp
```

**Config JSON (Claude Desktop / Cursor):**

```json
{
  "mcpServers": {
    "getly": {
      "command": "npx",
      "args": ["-y", "@getly/mcp"],
      "env": { "GETLY_API_KEY": "getly_sk_live_..." }
    }
  }
}
```

**Categories/tags:** e-commerce, payments, commerce, store, digital products, sales.

---

## 1. Official MCP registry (registry.modelcontextprotocol.io)

1. Add a `server.json` to `packages/mcp` per the registry schema
   (`name: "store.getly/mcp"` or the npm-based namespace — follow current schema docs
   at github.com/modelcontextprotocol/registry).
2. Install the publisher CLI: `npm i -g @modelcontextprotocol/registry-publisher`
   (verify current tool name in the registry repo README).
3. Authenticate via the supported method for npm-hosted servers (DNS or GitHub org
   verification for the `getly` namespace).
4. `mcp-publisher publish` from `packages/mcp`.
5. Verify the entry appears via the registry API, then re-check after each version
   bump (CI note: publishing a new npm version does NOT auto-update all mirrors).

## 2. Smithery (smithery.ai)

1. Sign in with the Getly-Store GitHub org account.
2. "Add server" → point at `Getly-Store/headless-sdk` → subdirectory `packages/mcp`
   (the `smithery.yaml` there declares the start command and the `GETLY_API_KEY`
   config field — marked `required` + `secret`).
3. Fill the listing with the shared copy above; set category **E-commerce**.
4. Test the hosted playground with a throwaway key from a test store; confirm
   `tools/list` returns 16 tools.
5. After approval, add the Smithery install badge to `packages/mcp/README.md`.

## 3. PulseMCP (pulsemcp.com)

1. Use the "Submit a server" form (footer link).
2. Provide: repo URL, npm package name, the one-liner, long description, install
   snippet. They scrape tool lists from the repo — make sure the README's tool table
   is current.
3. PulseMCP lists use-cases: submit "sell digital products from Claude",
   "Telegram sales bot backend", "AI-managed storefront".

## 4. Glama (glama.ai/mcp/servers)

1. Glama auto-indexes public MCP repos, but manual submission is faster:
   glama.ai → MCP → "Add server" (GitHub sign-in).
2. Ensure the repo has the `mcp` topic on GitHub and `packages/mcp/README.md`
   contains the config JSON block (their inspector parses it).
3. Their scanner runs the server: it must boot and answer `tools/list` WITHOUT a
   valid key (tools listed, calls fail gracefully with the
   "GETLY_API_KEY not set" hint) — this is already the packages/mcp behavior;
   don't regress it.
4. Claim the listing for the Getly-Store org so we can edit copy.

## 5. cursor.directory

1. Submit via the "Submit" flow on cursor.directory (GitHub sign-in) under **MCPs**.
2. Provide the Cursor-specific config (`.cursor/mcp.json` snippet — same JSON as
   above) and the one-liner.
3. Also submit a companion **rule**: the condensed Getly prompt from
   `prompts/golden` as a Cursor rule ("Getly commerce assistant") — directory rules
   rank well and link back to the MCP entry.

## 6. mcp.so

1. mcp.so submissions go through their GitHub repo issue template or the on-site
   form ("Submit MCP Server").
2. Provide name, repo, npm package, description, config JSON, category `E-commerce`.
3. They accept a logo — use the bald-G mascot mark (same as the PH gallery),
   512×512 PNG.

---

## Submission checklist

| Registry | Submitted | Approved/Live | Listing URL |
|---|---|---|---|
| Official MCP registry | ☐ | ☐ | |
| Smithery | ☐ | ☐ | |
| PulseMCP | ☐ | ☐ | |
| Glama | ☐ | ☐ | |
| cursor.directory | ☐ | ☐ | |
| mcp.so | ☐ | ☐ | |

After all six are live: add the badges/links to the repo README "MCP" section and
to getly.store/developers.
