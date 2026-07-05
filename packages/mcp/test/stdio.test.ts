/**
 * Boot the BUILT server over stdio and drive it with raw JSON-RPC:
 * initialize → notifications/initialized → tools/list. Asserts all 18 tools
 * are exposed with their annotations. Builds the package first if needed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG_DIR, 'dist', 'cli.js');

let child: ChildProcessWithoutNullStreams;
let buffer = '';
const pending = new Map<number, (msg: Record<string, unknown>) => void>();

function send(msg: Record<string, unknown>): void {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

function request(id: number, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for response ${id} (${method})`)), 30_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

beforeAll(() => {
  if (!existsSync(CLI)) {
    execSync('npm run build', { cwd: PKG_DIR, stdio: 'inherit', timeout: 120_000 });
  }

  child = spawn(process.execPath, [CLI], {
    cwd: PKG_DIR,
    env: { ...process.env, GETLY_API_KEY: 'getly_sk_live_test_not_a_real_key_0000' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        if (typeof msg.id === 'number' && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        }
      } catch {
        /* non-JSON stdout noise would be a protocol bug; ignored here, asserted implicitly by timeouts */
      }
    }
  });
}, 150_000);

afterAll(() => {
  child?.kill();
});

describe('stdio server (built dist)', () => {
  it('answers initialize and lists all 18 tools with annotations', async () => {
    const init = await request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'getly-mcp-test', version: '0.0.0' },
    });
    const initResult = init.result as { serverInfo: { name: string }; capabilities: Record<string, unknown> };
    expect(initResult.serverInfo.name).toBe('getly');
    expect(initResult.capabilities).toHaveProperty('tools');

    send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const list = await request(2, 'tools/list');
    const tools = (list.result as { tools: Array<{ name: string; description?: string; annotations?: Record<string, unknown> }> }).tools;

    expect(tools).toHaveLength(18);
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of [
      'list_products', 'get_product', 'create_product', 'update_product',
      'publish_product', 'archive_product', 'upload_product_file', 'upload_image',
      'create_blog_post', 'list_blog_posts', 'create_coupon', 'list_coupons',
      'create_checkout_link', 'get_checkout_link_status', 'list_licenses',
      'get_sales_stats', 'search_categories', 'get_store',
    ]) {
      expect(byName.has(name), `missing tool ${name}`).toBe(true);
    }
    expect(byName.get('list_products')!.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('archive_product')!.annotations?.destructiveHint).toBe(true);
    expect(byName.get('create_product')!.description).toBeTruthy();
  }, 60_000);

  it('confirm gate works end-to-end over the protocol', async () => {
    const call = await request(3, 'tools/call', {
      name: 'archive_product',
      arguments: { productId: '00000000-0000-4000-8000-000000000001' },
    });
    const result = call.result as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('confirm: true');
  }, 60_000);
});
