#!/usr/bin/env node
/**
 * generate-llms-txt.mjs — renders llms.txt (repo root) from
 * openapi/getly-v1.yaml. Zero dependencies: parses the YAML with a small
 * subset parser matched to the spec's formatting contract (2-space indent,
 * block scalars via | / |-, no flow collections except the empty [] / {},
 * no anchors/aliases, no inline comments after values).
 *
 * Usage:
 *   node scripts/generate-llms-txt.mjs           # (re)write llms.txt
 *   node scripts/generate-llms-txt.mjs --check   # exit 1 if llms.txt drifted
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.join(__dirname, '..', 'openapi', 'getly-v1.yaml');
const OUT_PATH = path.join(__dirname, '..', 'llms.txt');

// ---------------------------------------------------------------------------
// YAML-subset parser
// ---------------------------------------------------------------------------

function parseYaml(text) {
  const lines = text.split('\n');
  let pos = 0;

  const indentOf = (line) => {
    let i = 0;
    while (i < line.length && line[i] === ' ') i++;
    return i;
  };
  const isIgnorable = (line) => {
    const t = line.trim();
    return t === '' || t.startsWith('#');
  };
  const skipIgnorable = () => {
    while (pos < lines.length && isIgnorable(lines[pos])) pos++;
  };

  function fail(msg) {
    throw new Error(`YAML parse error at line ${pos + 1}: ${msg}\n> ${lines[pos] ?? '<eof>'}`);
  }

  function parseScalar(s) {
    if (s === '[]') return [];
    if (s === '{}') return {};
    if (s.startsWith("'")) {
      if (!s.endsWith("'") || s.length < 2) fail(`unterminated single-quoted scalar: ${s}`);
      return s.slice(1, -1).replace(/''/g, "'");
    }
    if (s.startsWith('"')) {
      try {
        return JSON.parse(s);
      } catch {
        fail(`bad double-quoted scalar: ${s}`);
      }
    }
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null' || s === '~') return null;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    return s;
  }

  function parseBlockScalar(parentIndent, strip) {
    const body = [];
    let blockIndent = null;
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.trim() === '') {
        body.push('');
        pos++;
        continue;
      }
      const ind = indentOf(line);
      if (ind <= parentIndent) break;
      if (blockIndent === null) blockIndent = ind;
      body.push(line.slice(Math.min(blockIndent, ind)));
      pos++;
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    const joined = body.join('\n');
    return strip ? joined : joined + '\n';
  }

  /** Split "key: rest" / "key:" — keys never contain ": " in this spec. */
  function splitKey(content) {
    const idx = content.indexOf(': ');
    let key;
    let rest;
    if (idx === -1) {
      if (!content.endsWith(':')) fail(`expected a "key:" mapping entry, got: ${content}`);
      key = content.slice(0, -1);
      rest = '';
    } else {
      key = content.slice(0, idx);
      rest = content.slice(idx + 2).trim();
    }
    if (
      (key.startsWith("'") && key.endsWith("'")) ||
      (key.startsWith('"') && key.endsWith('"'))
    ) {
      key = key.slice(1, -1);
    }
    return { key, rest };
  }

  const MAP_START_RE = /^(?:'[^']*'|"[^"]*"|[A-Za-z0-9_$][\w.$/{}-]*):( |$)/;

  function parseNode(minIndent) {
    skipIgnorable();
    if (pos >= lines.length) return null;
    const ind = indentOf(lines[pos]);
    if (ind < minIndent) return null;
    const content = lines[pos].slice(ind);
    if (content === '-' || content.startsWith('- ')) return parseSeq(ind);
    return parseMap(ind);
  }

  function parseMap(indent) {
    const obj = {};
    for (;;) {
      skipIgnorable();
      if (pos >= lines.length) break;
      const line = lines[pos];
      const ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) fail(`unexpected deeper indent (expected ${indent})`);
      const content = line.slice(ind);
      if (content === '-' || content.startsWith('- ')) break;
      const { key, rest } = splitKey(content);
      pos++;
      if (rest === '') {
        const child = parseNode(indent + 1);
        obj[key] = child;
      } else if (rest === '|' || rest === '|-') {
        obj[key] = parseBlockScalar(indent, rest === '|-');
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseSeq(indent) {
    const arr = [];
    for (;;) {
      skipIgnorable();
      if (pos >= lines.length) break;
      const line = lines[pos];
      const ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) fail(`unexpected deeper indent in sequence (expected ${indent})`);
      const content = line.slice(ind);
      if (content !== '-' && !content.startsWith('- ')) break;
      const rest = content === '-' ? '' : content.slice(2).trim();
      if (rest === '') {
        pos++;
        arr.push(parseNode(indent + 1));
      } else if (MAP_START_RE.test(rest)) {
        // "- key: value" — inline map start; re-park the line as an indented
        // map entry and let parseMap consume it plus its continuation lines.
        lines[pos] = ' '.repeat(indent + 2) + rest;
        arr.push(parseMap(indent + 2));
      } else {
        pos++;
        arr.push(parseScalar(rest));
      }
    }
    return arr;
  }

  const doc = parseNode(0);
  skipIgnorable();
  if (pos < lines.length) fail('trailing content after document');
  return doc;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const HTTP_METHODS = ['get', 'post', 'patch', 'put', 'delete'];

function resolveRef(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let node = spec;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part];
    if (node === undefined) return null;
  }
  return node;
}

function firstSuccessResponse(op) {
  for (const status of Object.keys(op.responses ?? {})) {
    if (/^2\d\d$/.test(String(status))) {
      return { status, response: op.responses[status] };
    }
  }
  return null;
}

function jsonExample(container) {
  return container?.content?.['application/json']?.example;
}

function codeBlock(lang, body) {
  return '```' + lang + '\n' + body.trimEnd() + '\n```';
}

function render(spec) {
  const out = [];
  const push = (...xs) => out.push(...xs);
  const info = spec.info ?? {};
  const server = spec.servers?.[0]?.url ?? 'https://www.getly.store';

  push(`# ${info.title ?? 'Getly v1 API'}`);
  push('');
  push(`> ${info.summary ?? ''}`);
  push('');
  push(
    'Generated from `openapi/getly-v1.yaml` (github.com/Getly-Store/headless-sdk) — do not edit by hand; run `node scripts/generate-llms-txt.mjs`.',
  );
  push('');
  push(`Base URL: ${server}`);
  push(`Machine-readable spec: ${server}/openapi.yaml`);
  push('');

  // Quickstart
  const quickstart = info['x-quickstart'] ?? [];
  if (quickstart.length > 0) {
    push('## Quickstart');
    push('');
    for (const step of quickstart) {
      push(`### ${step.title}`);
      push('');
      push(codeBlock('bash', String(step.curl ?? '')));
      push('');
    }
  }

  // Auth
  const bearer = spec.components?.securitySchemes?.bearerAuth;
  if (bearer?.description) {
    push('## Authentication');
    push('');
    push(bearer.description.trim());
    push('');
  }

  // Conventions
  if (info['x-conventions']) {
    push('## Conventions');
    push('');
    push(String(info['x-conventions']).trim());
    push('');
  }

  // Error codes
  const errorCodes = spec.components?.['x-error-codes'] ?? {};
  push('## Error codes');
  push('');
  push(
    'Every error response is `{ "success": false, "error": "<message>", "errorDetail": { "code", "message", "hint", "docsUrl", "param?" } }`. Branch on `errorDetail.code`:',
  );
  push('');
  for (const [code, hint] of Object.entries(errorCodes)) {
    push(`- \`${code}\` — ${hint}`);
  }
  push('');

  // Webhooks
  const wh = info['x-webhooks'];
  if (wh) {
    push('## Webhooks');
    push('');
    push(String(wh.description ?? '').trim());
    push('');
    if (Array.isArray(wh.events)) {
      push(`Events: ${wh.events.map((e) => '`' + e + '`').join(', ')}.`);
      push('');
    }
  }

  // Endpoints
  push('## Endpoints');
  push('');
  const paths = spec.paths ?? {};
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const op = pathItem?.[method];
      if (!op) continue;

      push(`### ${method.toUpperCase()} ${pathKey} — ${op.summary ?? ''}`);
      push('');
      const scope = op['x-public'] ? 'Public (no auth required)' : `scope \`${op['x-scope'] ?? '—'}\``;
      push(`operationId: \`${op.operationId}\` · ${scope}`);
      push('');
      if (op.description) {
        push(String(op.description).trim());
        push('');
      }

      // Parameters (resolve $refs)
      const params = (op.parameters ?? [])
        .map((p) => (p.$ref ? resolveRef(spec, p.$ref) : p))
        .filter(Boolean);
      if (params.length > 0) {
        push('Parameters:');
        for (const p of params) {
          const req = p.required ? ', required' : '';
          push(`- \`${p.name}\` (${p.in}${req}) — ${p.description ?? ''}`);
        }
        push('');
      }

      // Request example
      const reqExample = jsonExample(op.requestBody);
      if (reqExample !== undefined) {
        push('Request body example:');
        push('');
        push(codeBlock('json', JSON.stringify(reqExample, null, 2)));
        push('');
      }

      // Success response example
      const ok = firstSuccessResponse(op);
      if (ok) {
        const example = jsonExample(ok.response);
        if (example !== undefined) {
          push(`Response example (HTTP ${ok.status}):`);
          push('');
          push(codeBlock('json', JSON.stringify(example, null, 2)));
          push('');
        } else if (ok.response?.description) {
          push(`Response (HTTP ${ok.status}): ${ok.response.description}`);
          push('');
        }
      } else {
        // Redirect-style operation (e.g. /go/{linkId})
        const statuses = Object.keys(op.responses ?? {});
        if (statuses.length > 0) {
          const s = statuses[0];
          push(`Response (HTTP ${s}): ${op.responses[s]?.description ?? ''}`);
          push('');
        }
      }

      // Errors
      const errs = op['x-errors'] ?? [];
      if (errs.length > 0) {
        push(`Errors: ${errs.map((e) => '`' + e + '`').join(', ')}.`);
        push('');
      }
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const spec = parseYaml(readFileSync(SPEC_PATH, 'utf8'));

  // Sanity gates — a parser regression must fail loudly, not emit a stub.
  if (!spec || typeof spec !== 'object') throw new Error('spec did not parse to an object');
  if (!String(spec.openapi ?? '').startsWith('3.1')) {
    throw new Error(`expected openapi 3.1.x, got: ${spec.openapi}`);
  }
  const pathCount = Object.keys(spec.paths ?? {}).length;
  if (pathCount < 25) throw new Error(`suspiciously few paths parsed (${pathCount}) — parser regression?`);
  const opIds = [];
  for (const item of Object.values(spec.paths)) {
    for (const m of HTTP_METHODS) if (item?.[m]?.operationId) opIds.push(item[m].operationId);
  }
  if (new Set(opIds).size !== opIds.length) throw new Error('duplicate operationIds in spec');
  for (const required of ['createProduct', 'publishProduct', 'createCheckoutLink', 'validateLicense']) {
    if (!opIds.includes(required)) throw new Error(`missing required operationId: ${required}`);
  }

  const rendered = render(spec);

  if (process.argv.includes('--check')) {
    let committed = '';
    try {
      committed = readFileSync(OUT_PATH, 'utf8');
    } catch {
      console.error('llms.txt is missing — run: node scripts/generate-llms-txt.mjs');
      process.exit(1);
    }
    if (committed !== rendered) {
      console.error('llms.txt is out of date with openapi/getly-v1.yaml — run: node scripts/generate-llms-txt.mjs');
      process.exit(1);
    }
    console.log(`llms.txt is up to date (${pathCount} paths, ${opIds.length} operations).`);
    return;
  }

  writeFileSync(OUT_PATH, rendered);
  console.log(`Wrote llms.txt (${pathCount} paths, ${opIds.length} operations, ${rendered.length} bytes).`);
}

main();
