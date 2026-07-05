import { describe, it, expect } from 'vitest';
import { Getly, GetlyError } from '../src/index.js';
import { scriptedFetch, jsonResponse } from './helpers.js';

const KEY = 'getly_sk_live_' + 'a'.repeat(64);

describe('error parsing', () => {
  it('parses the errorDetail envelope + rate-limit headers into GetlyError', async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 403,
        body: {
          success: false,
          error: 'Missing scope: write:products',
          errorDetail: {
            code: 'insufficient_scope',
            message: 'Missing scope: write:products',
            hint: 'Create a key with the needed scope.',
            docsUrl: 'https://www.getly.store/developers/api#errors',
            param: 'write:products',
          },
        },
        headers: { 'X-RateLimit-Limit': '30', 'X-RateLimit-Remaining': '29', 'X-RateLimit-Reset': '42' },
      },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    const err = await getly.products
      .create({ name: 'X', priceCents: 100 })
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(GetlyError);
    const ge = err as GetlyError;
    expect(ge.status).toBe(403);
    expect(ge.code).toBe('insufficient_scope');
    expect(ge.message).toBe('Missing scope: write:products');
    expect(ge.hint).toBe('Create a key with the needed scope.');
    expect(ge.docsUrl).toBe('https://www.getly.store/developers/api#errors');
    expect(ge.param).toBe('write:products');
    expect(ge.rateLimit).toEqual({ limit: 30, remaining: 29, resetSeconds: 42, retryAfterSeconds: null });
  });

  it('falls back to a status-derived code for legacy plain-error routes', async () => {
    const { fetchImpl } = scriptedFetch([
      { status: 404, body: { success: false, error: 'Order not found' } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    const err = (await getly.orders.get('11111111-1111-1111-1111-111111111111').catch((e: unknown) => e)) as GetlyError;
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('Order not found');
  });

  it('exposes machine-readable publish reasons on 422 not_publishable', async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 422,
        body: {
          success: false,
          error: 'Product is not publishable',
          errorDetail: { code: 'not_publishable', message: 'Product is not publishable' },
          reasons: [{ code: 'missing_file', detail: 'Attach at least one downloadable file first.' }],
        },
      },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    const err = (await getly.products.publish('p1').catch((e: unknown) => e)) as GetlyError;
    expect(err.code).toBe('not_publishable');
    expect(err.reasons).toEqual([{ code: 'missing_file', detail: 'Attach at least one downloadable file first.' }]);
  });

  it('throws a clear unauthorized error when no API key is configured', async () => {
    const { fetchImpl, calls } = scriptedFetch([]);
    const original = process.env.GETLY_API_KEY;
    delete process.env.GETLY_API_KEY;
    try {
      const getly = new Getly({ fetch: fetchImpl });
      const err = (await getly.products.list().catch((e: unknown) => e)) as GetlyError;
      expect(err).toBeInstanceOf(GetlyError);
      expect(err.code).toBe('unauthorized');
      expect(err.message).toContain('GETLY_API_KEY');
      expect(calls.length).toBe(0); // never hit the network
    } finally {
      if (original !== undefined) process.env.GETLY_API_KEY = original;
    }
  });
});

describe('idempotency', () => {
  it('auto-generates an Idempotency-Key (UUID) on creates', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 201, body: { success: true, data: { id: 'p1' } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    await getly.products.create({ name: 'X', priceCents: 100 });

    const sent = calls[0].headers['idempotency-key'];
    expect(sent).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(calls[0].headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(calls[0].headers['x-getly-client']).toBe('@getly/sdk/0.1.0');
  });

  it('honors a caller-provided idempotencyKey verbatim', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 201, body: { success: true, data: { id: 'p1' } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    await getly.products.create({ name: 'X', priceCents: 100 }, { idempotencyKey: 'my-key-42' });
    expect(calls[0].headers['idempotency-key']).toBe('my-key-42');
  });

  it('does NOT attach a key to unauthenticated public POSTs', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: { valid: false } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    await getly.licenses.validate({ key: 'GETLY-XXXX' });
    expect(calls[0].headers['idempotency-key']).toBeUndefined();
    expect(calls[0].headers['authorization']).toBeUndefined();
  });
});

describe('429 retry', () => {
  it('retries an idempotent create after Retry-After and succeeds', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      {
        status: 429,
        body: { success: false, error: 'Too many requests', errorDetail: { code: 'rate_limited', message: 'Too many requests' } },
        headers: { 'Retry-After': '0', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '0' },
      },
      { status: 201, body: { success: true, data: { id: 'p1', priceCents: 100 } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    const product = await getly.products.create({ name: 'X', priceCents: 100 });
    expect(product.id).toBe('p1');
    expect(calls.length).toBe(2);
    // Same Idempotency-Key on both attempts → the server replays, never duplicates.
    expect(calls[0].headers['idempotency-key']).toBe(calls[1].headers['idempotency-key']);
  });

  it('gives up after maxRetries and throws rate_limited', async () => {
    const rl = {
      status: 429,
      body: { success: false, error: 'Too many requests', errorDetail: { code: 'rate_limited', message: 'Too many requests' } },
      headers: { 'Retry-After': '0' },
    };
    const { fetchImpl, calls } = scriptedFetch([rl, rl]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl, maxRetries: 1 });

    const err = (await getly.products.list().catch((e: unknown) => e)) as GetlyError;
    expect(err.code).toBe('rate_limited');
    expect(err.rateLimit.retryAfterSeconds).toBe(0);
    expect(calls.length).toBe(2); // initial + 1 retry
  });

  it('does NOT retry a public POST without an Idempotency-Key', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      {
        status: 429,
        body: { success: false, error: 'Too many requests', errorDetail: { code: 'rate_limited', message: 'Too many requests' } },
        headers: { 'Retry-After': '0' },
      },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    const err = (await getly.licenses.validate({ key: 'GETLY-XXXX' }).catch((e: unknown) => e)) as GetlyError;
    expect(err.code).toBe('rate_limited');
    expect(calls.length).toBe(1);
  });
});

describe('cursor iteration', () => {
  it('walks nextCursor across pages and stops at null', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'CURSOR2' } } },
      { body: { success: true, data: { items: [{ id: 'c' }], nextCursor: null } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    const seen: string[] = [];
    for await (const p of getly.products.iterate({ limit: 2 })) seen.push(p.id);

    expect(seen).toEqual(['a', 'b', 'c']);
    expect(calls.length).toBe(2);
    expect(calls[0].url).not.toContain('cursor=');
    expect(new URL(calls[1].url).searchParams.get('cursor')).toBe('CURSOR2');
  });
});

describe('proactive throttle', () => {
  it('waits for the reset window when remaining <= 1', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      {
        body: { success: true, data: { items: [], nextCursor: null } },
        headers: { 'X-RateLimit-Limit': '120', 'X-RateLimit-Remaining': '1', 'X-RateLimit-Reset': '1' },
      },
      { body: { success: true, data: { items: [], nextCursor: null } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });

    await getly.products.list();
    const before = Date.now();
    await getly.products.list();
    const waited = Date.now() - before;

    expect(calls.length).toBe(2);
    expect(waited).toBeGreaterThanOrEqual(900); // ~1s reset window honored
  }, 10000);
});
