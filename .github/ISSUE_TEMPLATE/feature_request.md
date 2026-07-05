---
name: Feature request
about: Propose an addition to the SDK, MCP tools, or examples
title: ''
labels: enhancement
assignees: ''
---

## What problem are you solving?

<!-- The task you're trying to do, not the solution you have in mind.
     "As a bot builder, I need to know a link expired without polling" beats
     "add an expiredAt field". -->

## Proposed shape (optional)

```ts
// Sketch the API/tool call you wish existed.
```

## Which layer?

- [ ] `@getly/sdk` (client)
- [ ] `@getly/mcp` (tools)
- [ ] `@getly/nextjs` / examples / docs
- [ ] The Getly platform API itself (we route these to the platform team — still file it here)

## Notes for the ambitious

New runtime dependencies are effectively a no (see CONTRIBUTING.md — minimal-deps
policy), and new MCP tools are added sparingly on purpose. Already-planned "help
wanted" items: Python SDK, webhook-listener example, GitHub Action — check open
issues before filing a duplicate.
