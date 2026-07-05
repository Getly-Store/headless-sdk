# Contributing to the Getly Headless SDK

Thanks for helping. This file is short; please actually read it — especially the
dependency and CI-security rules, which are hard requirements, not suggestions.

## Dev setup

```bash
git clone https://github.com/Getly-Store/headless-sdk
cd headless-sdk
npm ci                 # Node >= 18 (CI runs 22); npm workspaces monorepo
npm run typecheck      # tsc across all workspaces
npm test               # vitest across all workspaces
```

Work inside one package:

```bash
cd packages/sdk-js
npm test               # vitest is hoisted from the root — no per-package install
```

Examples (`examples/*`) are not workspaces — they have their own `npm install` and
their own READMEs.

### Testing against the real API

There is no test mode yet. Use a dedicated store + an API key with only the scopes
your change touches, and a $1 product for money-path checks. Never commit keys;
`GETLY_API_KEY` comes from your environment. Unit tests must NOT hit the network —
mock `fetch` (see existing tests for the pattern).

## The minimal-dependencies policy

This repo is something people pipe API keys through, so the supply-chain surface
stays as close to zero as we can hold it:

- **`@getly/sdk`: ZERO runtime dependencies.** Not one. PRs adding a runtime dep to
  sdk-js will be closed with a link to this line.
- Other packages: only what's essential and already agreed —
  `@modelcontextprotocol/sdk` + `zod` (mcp), `@anthropic-ai/sdk` (auto-store).
  Anything new needs a maintainer's explicit OK **in the issue before the PR**.
- devDependencies are shared at the root (`typescript`, `vitest`) — don't duplicate
  them per package.
- Prefer 30 lines of vendored, tested code over a 30-KB transitive tree.

## CI & repo security rules

- **All GitHub Actions are SHA-pinned** (`uses: owner/action@<full-sha> # vX.Y.Z`).
  Tag-pinned actions (`@v4`) will fail review — tags are mutable, SHAs are not.
- **`pull_request_target` is banned** in this repo. CI intentionally needs zero
  secrets; workflows run with `permissions: contents: read`. If a future workflow
  needs more, it gets the minimum, per-job, with a comment explaining why.
- Workflow changes get extra review scrutiny; expect questions.

## For maintainers: publishing to npm

- Packages publish under the `@getly` scope with **npm provenance**
  (`npm publish --provenance --access public` from a GitHub Actions release workflow
  with `id-token: write`) so every tarball is publicly traceable to a commit + run.
- Publishing requires the npm org (2FA enforced org-wide) — a founder action.
  Never publish from a laptop; if it isn't in the release workflow log, it doesn't
  ship.
- Version bumps: keep `0.x` semver honest — breaking API/tool-name changes bump the
  minor during 0.x and are called out in the release notes.

## PR checklist

- [ ] `npm run typecheck` and `npm test` green at the root
- [ ] No new runtime dependencies (or a maintainer pre-approved them in the issue)
- [ ] Public behavior changes reflected in the affected package README
- [ ] API-shape claims match the live API (`https://www.getly.store/api/v1/…`) — the
      OpenAPI spec in `openapi/` is the contract; drift check runs in CI
- [ ] No secrets, keys, or real customer data in code, tests, or fixtures

## Conduct & scope

Be direct, be kind. Big features (new packages, new tool surfaces) start as an issue,
not a 2,000-line PR — deliberately-cut items (Python SDK, webhook-listener example,
GitHub Action) are tracked as `help wanted` issues; grab one of those first if you
want a meaty contribution that's guaranteed mergeable.
