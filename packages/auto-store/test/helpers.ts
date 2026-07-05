/**
 * Shared test helpers: tmp fixture folders, a recording fake fetch, a fake
 * Anthropic client, and a canonical valid listing.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CategoryNode } from '../src/categories.js';
import { PRODUCT_SLUG_PLACEHOLDER, type DraftedListing } from '../src/types.js';
import type { AnthropicLike } from '../src/draft.js';

export const SAMPLE_LISTING: DraftedListing = {
  name: 'Minimal Icon Pack',
  shortDescription: 'A crisp set of 24 minimal line icons for dashboards.',
  description: '## What you get\n\n24 hand-drawn line icons in SVG and PNG.',
  tags: ['icons', 'svg', 'ui'],
  suggestedPriceCents: 900,
  categoryQuery: 'icons',
  blogArticle: {
    title: 'Designing a minimal icon set',
    contentMarkdown: `Icons matter.\n\n${PRODUCT_SLUG_PLACEHOLDER}\n\nMore words here.`,
    excerpt: 'How and why we drew 24 minimal icons.',
  },
};

export const SAMPLE_TREE: CategoryNode[] = [
  {
    id: 'cat-gd',
    name: 'Graphics & Design',
    slug: 'graphics-design',
    parentId: null,
    children: [
      { id: 'cat-icons', name: 'Icons & UI Elements', slug: 'icons-ui-elements', parentId: 'cat-gd', children: [] },
      { id: 'cat-fonts', name: 'Fonts', slug: 'fonts', parentId: 'cat-gd', children: [] },
    ],
  },
  {
    id: 'cat-dev',
    name: 'Developer Tools',
    slug: 'developer-tools',
    parentId: null,
    children: [
      { id: 'cat-cli', name: 'CLI Tools', slug: 'cli-tools', parentId: 'cat-dev', children: [] },
    ],
  },
];

export function fakeAnthropic(listing: unknown = SAMPLE_LISTING): AnthropicLike {
  return {
    messages: {
      create: async () => ({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', name: 'draft_listing', input: listing }],
      }),
    },
  };
}

export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export type RouteHandler = (call: RecordedCall) => { status?: number; json?: unknown } | undefined;

/**
 * Recording fake fetch. Routes are matched by `METHOD pathname` prefix.
 * Unmatched requests throw so tests never silently hit the network.
 */
export function fakeFetch(routes: Record<string, RouteHandler | { status?: number; json?: unknown }>) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) {
      headers[k.toLowerCase()] = v;
    }
    let body: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    } else if (init?.body) {
      body = '<bytes>';
    }
    const pathname = url.startsWith('http') ? new URL(url).pathname : url;
    const call: RecordedCall = { method, url, headers, body };
    calls.push(call);

    const key = `${method} ${pathname}`;
    for (const [route, handler] of Object.entries(routes)) {
      if (key.startsWith(route)) {
        const result = typeof handler === 'function' ? handler(call) : handler;
        if (result) {
          const status = result.status ?? 200;
          return new Response(JSON.stringify(result.json ?? { success: true, data: {} }), {
            status,
            headers: { 'content-type': 'application/json' },
          });
        }
      }
    }
    throw new Error(`fakeFetch: unrouted request ${key}`);
  }) as typeof fetch;
  return { impl, calls };
}

const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0300050001',
  'hex',
);

/** Creates a realistic product folder in a fresh tmp dir. */
export async function makeFixtureFolder(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autostore-fixture-'));
  await fs.writeFile(
    path.join(dir, 'README.md'),
    '# Minimal Icon Pack\n\n24 minimal line icons for dashboards, in SVG and PNG.\n',
  );
  await fs.writeFile(path.join(dir, 'preview.png'), TINY_PNG);
  await fs.mkdir(path.join(dir, 'icons'));
  await fs.writeFile(path.join(dir, 'icons', 'pack.zip'), Buffer.from('PKfakezip'));
  await fs.writeFile(path.join(dir, 'LICENSE.txt'), 'MIT-style license text.\n');
  // Should be ignored by the scanner:
  await fs.writeFile(path.join(dir, '.hidden'), 'nope');
  await fs.mkdir(path.join(dir, 'node_modules'));
  await fs.writeFile(path.join(dir, 'node_modules', 'junk.js'), 'ignored');
  return dir;
}

export async function rmrf(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
