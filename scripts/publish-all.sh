#!/usr/bin/env bash
# Publish all packages to npm in dependency order.
# Prereqs: `npm login` as a user with publish rights on the @getly scope
# (create the org first: https://www.npmjs.com/org/create → name "getly").
set -euo pipefail
cd "$(dirname "$0")/.."

npm whoami >/dev/null || { echo "Run 'npm login' first"; exit 1; }

echo "Building all packages…"
npm run build

# Order matters: @getly/sdk is a runtime dep of nextjs and auto-store.
for pkg in sdk-js nextjs mcp auto-store create-getly-store; do
  echo "── publishing packages/$pkg ──"
  (cd "packages/$pkg" && npm publish)
done

echo ""
echo "✅ All published. Verify:"
echo "  npx -y @getly/mcp --help"
echo "  npx -y create-getly-store --help"
