/**
 * upload_image / upload_product_file — these tools route through @getly/sdk
 * (uploads.uploadImage / products.uploadFile). Mocked fetch asserts the full
 * presign → PUT (→ attach) sequence and the local guardrails.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS } from '../src/tools.js';

function tool(name: string) {
  const t = TOOLS.find((t) => t.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

const ORIGINAL_ENV = { ...process.env };
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'getly-mcp-uploads-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.GETLY_API_KEY = 'getly_sk_live_test_0000000000';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('upload_image (sdk uploads.uploadImage)', () => {
  it('presigns, PUTs the bytes, and returns the public URL', async () => {
    const imgPath = join(dir, 'cover.png');
    const bytes = Buffer.from('fake-png-bytes-1234');
    await writeFile(imgPath, bytes);

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchSpy = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return jsonResponse({
          uploadUrl: 'https://r2.example.com/put/abc',
          publicUrl: 'https://cdn.getly.store/images/abc.png',
          expiresIn: 3600,
        });
      }
      return new Response(null, { status: 200 }); // presigned PUT
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await tool('upload_image').handler({ filePath: imgPath });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('https://cdn.getly.store/images/abc.png');

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/api/v1/uploads/images/presign');
    const presignBody = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(presignBody.contentType).toBe('image/png');
    expect(presignBody.fileSize).toBe(bytes.byteLength);
    expect(calls[1].url).toBe('https://r2.example.com/put/abc');
    expect(calls[1].init?.method).toBe('PUT');
  });

  it('refuses unsupported extensions without touching the network', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network must not be touched');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await tool('upload_image').handler({ filePath: join(dir, 'archive.zip') });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unsupported image type');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a missing file without touching the network', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network must not be touched');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await tool('upload_image').handler({ filePath: join(dir, 'nope.png') });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('File not found');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('upload_product_file (sdk products.uploadFile)', () => {
  it('runs the full presign → PUT → attach flow', async () => {
    const filePath = join(dir, 'asset-pack.zip');
    const bytes = Buffer.from('zip-bytes-'.repeat(10));
    await writeFile(filePath, bytes);
    const productId = '00000000-0000-4000-8000-000000000001';

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchSpy = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return jsonResponse({
          uploadUrl: 'https://r2.example.com/put/file-1',
          fileUrl: 'https://files.getly.store/f/file-1.zip',
          key: 'f/file-1.zip',
          fileName: 'asset-pack.zip',
          fileSize: bytes.byteLength,
        });
      }
      if (calls.length === 2) return new Response(null, { status: 200 }); // PUT
      return jsonResponse({
        id: 'file-1',
        fileName: 'asset-pack.zip',
        fileSize: bytes.byteLength,
        fileType: 'application/zip',
        isLatest: true,
        createdAt: '2026-07-05T00:00:00.000Z',
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await tool('upload_product_file').handler({
      filePath,
      productId,
      fileType: 'application/zip',
      versionNotes: 'v1.0',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Attached \\"asset-pack.zip\\"');
    expect(result.content[0].text).toContain('"id": "file-1"');

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toContain(`/api/v1/products/${productId}/files/presign`);
    const presignBody = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(presignBody).toMatchObject({
      fileName: 'asset-pack.zip',
      fileSize: bytes.byteLength,
      fileType: 'application/zip',
    });
    expect(calls[1].init?.method).toBe('PUT');
    expect(calls[2].url).toContain(`/api/v1/products/${productId}/files`);
    const attachBody = JSON.parse(String(calls[2].init?.body)) as Record<string, unknown>;
    expect(attachBody).toMatchObject({
      fileUrl: 'https://files.getly.store/f/file-1.zip',
      fileName: 'asset-pack.zip',
      fileSize: bytes.byteLength,
      fileType: 'application/zip',
      versionNotes: 'v1.0',
    });
  });

  it('surfaces sdk GetlyError (e.g. presign quota) as a formatted tool error', async () => {
    const filePath = join(dir, 'again.zip');
    await writeFile(filePath, Buffer.from('x'));

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: 'Daily upload quota exceeded',
            errorDetail: {
              code: 'quota_exceeded',
              message: 'Daily upload quota exceeded',
              hint: 'Retry after the UTC midnight reset.',
            },
          }),
          // 403 (not 429) so the SDK's automatic retry/backoff stays out of
          // the test — the stable `code` still travels via errorDetail.
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const result = await tool('upload_product_file').handler({
      filePath,
      productId: '00000000-0000-4000-8000-000000000001',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('quota_exceeded');
    expect(result.content[0].text).toContain('Hint: Retry after the UTC midnight reset.');
  }, 20_000);
});
