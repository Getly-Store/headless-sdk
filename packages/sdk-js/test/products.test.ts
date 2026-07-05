import { describe, it, expect } from 'vitest';
import { Getly, GetlyError } from '../src/index.js';
import { scriptedFetch } from './helpers.js';

const KEY = 'getly_sk_live_' + 'b'.repeat(64);

describe('uploadFile — presign → PUT → attach orchestration', () => {
  it('runs the 3 steps with matching sizes and returns the attached file', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const { fetchImpl, calls } = scriptedFetch([
      {
        match: '/files/presign',
        body: {
          success: true,
          data: {
            uploadUrl: 'https://r2.example.com/upload?sig=abc',
            fileUrl: 'https://cdn.getly.store/files/u1/xyz.zip',
            key: 'files/u1/xyz.zip',
            fileName: 'pack.zip',
            fileSize: 5,
          },
        },
      },
      { match: 'r2.example.com', body: {} },
      {
        match: '/files',
        status: 201,
        body: {
          success: true,
          data: { id: 'f1', fileName: 'pack.zip', fileSize: 5, fileType: 'application/zip', isLatest: true, createdAt: '2026-07-04T00:00:00.000Z' },
        },
      },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    const file = await getly.products.uploadFile('prod-1', {
      fileName: 'pack.zip',
      data,
      fileType: 'application/zip',
    });

    expect(file.id).toBe('f1');
    expect(calls.length).toBe(3);

    // 1) presign carries the exact byte count
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/api/v1/products/prod-1/files/presign');
    expect(JSON.parse(calls[0].body as string)).toEqual({ fileName: 'pack.zip', fileSize: 5, fileType: 'application/zip' });

    // 2) PUT of the raw bytes with Content-Length (signed header)
    expect(calls[1].method).toBe('PUT');
    expect(calls[1].url).toBe('https://r2.example.com/upload?sig=abc');
    expect(calls[1].headers['content-length']).toBe('5');
    expect(calls[1].headers['content-type']).toBe('application/zip');
    expect(calls[1].headers['authorization']).toBeUndefined(); // never leak the key to storage

    // 3) attach references the presigned fileUrl
    expect(calls[2].method).toBe('POST');
    expect(calls[2].url).toContain('/api/v1/products/prod-1/files');
    expect(JSON.parse(calls[2].body as string)).toMatchObject({
      fileUrl: 'https://cdn.getly.store/files/u1/xyz.zip',
      fileName: 'pack.zip',
      fileSize: 5,
    });
  });

  it('rejects empty data client-side without any network call', async () => {
    const { fetchImpl, calls } = scriptedFetch([]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    const err = (await getly.products
      .uploadFile('p1', { fileName: 'x.zip', data: new Uint8Array(0) })
      .catch((e: unknown) => e)) as GetlyError;
    expect(err.code).toBe('validation_failed');
    expect(calls.length).toBe(0);
  });

  it('surfaces a failed storage PUT as a clear error', async () => {
    const { fetchImpl } = scriptedFetch([
      {
        match: '/files/presign',
        body: { success: true, data: { uploadUrl: 'https://r2.example.com/u', fileUrl: 'https://cdn.getly.store/files/u1/a.zip', key: 'k', fileName: 'a.zip', fileSize: 3 } },
      },
      { match: 'r2.example.com', status: 403, body: 'denied' },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    const err = (await getly.products
      .uploadFile('p1', { fileName: 'a.zip', data: new Uint8Array([1, 2, 3]) })
      .catch((e: unknown) => e)) as GetlyError;
    expect(err).toBeInstanceOf(GetlyError);
    expect(err.status).toBe(403);
    expect(err.message).toContain('storage upload failed');
  });
});

describe('createMany — throttled batch with partial failure', () => {
  it('returns per-item results and keeps going after one failure', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 201, body: { success: true, data: { id: 'p-ok-1', name: 'A' } } },
      {
        status: 400,
        body: {
          success: false,
          error: 'Invalid product name',
          errorDetail: { code: 'validation_failed', message: 'Invalid product name', param: 'name' },
        },
      },
      { status: 201, body: { success: true, data: { id: 'p-ok-3', name: 'C' } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    const progress: number[] = [];
    const results = await getly.products.createMany(
      [
        { name: 'A', priceCents: 100 },
        { name: '', priceCents: 200 },
        { name: 'C', priceCents: 300 },
      ],
      {
        concurrency: 1,
        idempotencyKeyPrefix: 'batch-2026-07-04',
        onProgress: (_r, completed) => progress.push(completed),
      },
    );

    expect(results.length).toBe(3);
    expect(results[0]).toMatchObject({ index: 0, ok: true });
    expect(results[0].product?.id).toBe('p-ok-1');
    expect(results[1].ok).toBe(false);
    expect((results[1].error as GetlyError).code).toBe('validation_failed');
    expect(results[2]).toMatchObject({ index: 2, ok: true });
    expect(progress).toEqual([1, 2, 3]);

    // Deterministic resume keys: prefix:index
    expect(calls.map((c) => c.headers['idempotency-key'])).toEqual([
      'batch-2026-07-04:0',
      'batch-2026-07-04:1',
      'batch-2026-07-04:2',
    ]);
  });

  it('stops calling the API after quota_exceeded and fails the rest locally', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 201, body: { success: true, data: { id: 'p1' } } },
      {
        status: 429,
        body: {
          success: false,
          error: 'Daily product creation cap reached (20 per day per API key)',
          errorDetail: { code: 'quota_exceeded', message: 'Daily product creation cap reached (20 per day per API key)' },
        },
      },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl, maxRetries: 0 });

    const results = await getly.products.createMany(
      [
        { name: 'A', priceCents: 1 },
        { name: 'B', priceCents: 2 },
        { name: 'C', priceCents: 3 },
        { name: 'D', priceCents: 4 },
      ],
      { concurrency: 1 },
    );

    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect((results[1].error as GetlyError).code).toBe('quota_exceeded');
    // Items after the quota hit never reach the network.
    expect(results[2].ok).toBe(false);
    expect((results[2].error as GetlyError).code).toBe('quota_exceeded');
    expect(results[3].ok).toBe(false);
    expect(calls.length).toBe(2);
  });
});

describe('publicStore', () => {
  it('fetches public products without auth', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      {
        body: {
          success: true,
          data: {
            store: { id: 's1', name: 'Soft Premium', slug: 'softpremium' },
            items: [{ id: 'p1', slug: 'icons', name: 'Icons', priceCents: 900, price: 900, currency: 'USD', avgRating: 5, reviewCount: 2, images: [], urls: { product: 'x', buy: 'y' }, shortDescription: null }],
            nextCursor: null,
          },
        },
      },
    ]);
    // No apiKey at all — public endpoints must work without one.
    const original = process.env.GETLY_API_KEY;
    delete process.env.GETLY_API_KEY;
    try {
      const getly = new Getly({ fetch: fetchImpl });
      const res = await getly.publicStore.products('softpremium');
      expect(res.store.slug).toBe('softpremium');
      expect(res.items[0].priceCents).toBe(900);
      expect(calls[0].headers['authorization']).toBeUndefined();
    } finally {
      if (original !== undefined) process.env.GETLY_API_KEY = original;
    }
  });
});
