#!/usr/bin/env node
/**
 * Vendor openapi/getly-v1.yaml and the generated llms.txt into the Getly
 * platform's /openapi.yaml and /llms-api.txt route handlers.
 *
 * Usage: node scripts/vendor-to-platform.mjs [/path/to/Getly.store]
 * Run generate-llms-txt.mjs first so llms.txt is current.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const platform = process.argv[2] || '/Users/Apple/Desktop/Getly.store';

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const spec = fs.readFileSync(path.join(repo, 'openapi/getly-v1.yaml'), 'utf8');
const llms = fs.readFileSync(path.join(repo, 'llms.txt'), 'utf8');

const files = [
  {
    out: path.join(platform, 'src/app/openapi.yaml/route.ts'),
    content: spec,
    constName: 'SPEC',
    contentType: 'application/yaml; charset=utf-8',
    header: `/**
 * GET /openapi.yaml — serves the Getly v1 OpenAPI 3.1 spec.
 *
 * synced from Getly-Store/headless-sdk openapi/getly-v1.yaml
 * (the SDK repo is the source of truth; regenerate this file with
 * scripts/vendor-to-platform.mjs when the spec changes — the platform must
 * not read from the SDK repo at runtime).
 */`,
  },
  {
    out: path.join(platform, 'src/app/llms-api.txt/route.ts'),
    content: llms,
    constName: 'LLMS',
    contentType: 'text/plain; charset=utf-8',
    header: `/**
 * GET /llms-api.txt — the full v1 API reference as one AI-readable file.
 *
 * synced from Getly-Store/headless-sdk llms.txt (GENERATED there from
 * openapi/getly-v1.yaml via scripts/generate-llms-txt.mjs — never edit by
 * hand; regenerate + re-vendor via scripts/vendor-to-platform.mjs).
 */`,
  },
];

for (const f of files) {
  const escaped = esc(f.content);
  // round-trip safety: the escaped literal must evaluate back byte-identical
  const roundtrip = new Function('return `' + escaped + '`;')();
  if (roundtrip !== f.content) throw new Error(`round-trip mismatch for ${f.out}`);
  const route = `${f.header}
import { NextResponse } from 'next/server';

const ${f.constName} = \`${escaped}\`;

export function GET() {
  return new NextResponse(${f.constName}, {
    headers: {
      'Content-Type': '${f.contentType}',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
`;
  fs.writeFileSync(f.out, route);
  console.log(`vendored ${f.out} (${f.content.length} bytes, round-trip OK)`);
}
