import { describe, it, expect } from 'vitest';
import { Getly, GetlyError, KEYS_PER_REQUEST_MAX } from '../src/index.js';
import { scriptedFetch } from './helpers.js';

const KEY = 'getly_sk_live_' + 'd'.repeat(64);
const PID = '3f6f4a3e-9d1e-4c1b-8f2a-1a2b3c4d5e6f';
const KID = '8b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

const pool = {
  keyPoolEnabled: true,
  keyPoolLowThreshold: 5,
  counts: { available: 1, issued: 1, waiting: 0 },
  keys: [
    { id: KID, masked: 'ABCD…WXYZ', status: 'issued', issuedAt: '2026-09-20T14:02:11.000Z', orderItemId: 'oi1', refunded: false },
    { id: 'k2', masked: 'EFGH…STUV', status: 'available', issuedAt: null, orderItemId: null, refunded: false },
  ],
  limit: 50,
  offset: 0,
  total: 2,
};

describe('products.keys (seller key pool)', () => {
  it('lists counters and masked keys with limit/offset', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ body: { success: true, data: pool } }]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const out = await getly.products.keys.list(PID, { limit: 10, offset: 20 });
    expect(out.counts.available).toBe(1);
    expect(out.keys[0].masked).toBe('ABCD…WXYZ');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain(`/api/v1/products/${PID}/keys?limit=10&offset=20`);
  });

  it('iterates until total is reached', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: { ...pool, keys: [pool.keys[0]], limit: 1, total: 2 } } },
      { body: { success: true, data: { ...pool, keys: [pool.keys[1]], limit: 1, offset: 1, total: 2 } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const ids: string[] = [];
    for await (const k of getly.products.keys.iterate(PID, { limit: 1 })) ids.push(k.id);
    expect(ids).toEqual([KID, 'k2']);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('offset=1');
  });

  it('adds keys as { keys } with an Idempotency-Key', async () => {
    const result = { added: 2, duplicates: 0, duplicatesInInput: 0, tooLong: 0, blank: 0, filled: 1 };
    const { fetchImpl, calls } = scriptedFetch([{ status: 201, body: { success: true, data: result } }]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const out = await getly.products.keys.add(PID, ['AAAA-0001', 'AAAA-0002']);
    expect(out).toEqual(result);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['idempotency-key']).toBeTruthy();
    expect(JSON.parse(String(calls[0].body))).toEqual({ keys: ['AAAA-0001', 'AAAA-0002'] });
  });

  it('refuses more than 5000 keys in one add without calling the API', async () => {
    const { fetchImpl, calls } = scriptedFetch([]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const keys = Array.from({ length: KEYS_PER_REQUEST_MAX + 1 }, (_, i) => `K-${i}`);
    const err = (await getly.products.keys.add(PID, keys).catch((e: unknown) => e)) as GetlyError;
    expect(err).toBeInstanceOf(GetlyError);
    expect(err.code).toBe('validation_failed');
    expect(calls).toHaveLength(0);
  });

  it('addMany chunks at 5000 and sums the counters', async () => {
    const r = (n: number) => ({ added: n, duplicates: 1, duplicatesInInput: 0, tooLong: 0, blank: 0, filled: 0 });
    const { fetchImpl, calls } = scriptedFetch([
      { status: 201, body: { success: true, data: r(4999) } },
      { status: 201, body: { success: true, data: r(3) } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const keys = Array.from({ length: KEYS_PER_REQUEST_MAX + 3 }, (_, i) => `K-${i}`);
    const out = await getly.products.keys.addMany(PID, keys, { idempotencyKeyPrefix: 'import-1' });
    expect(out.added).toBe(5002);
    expect(out.duplicates).toBe(2);
    expect(JSON.parse(String(calls[0].body)).keys).toHaveLength(KEYS_PER_REQUEST_MAX);
    expect(JSON.parse(String(calls[1].body)).keys).toHaveLength(3);
    expect(calls[0].headers['idempotency-key']).toBe('import-1:0');
    expect(calls[1].headers['idempotency-key']).toBe('import-1:1');
  });

  it('removes an unsold key; an issued key is key_not_available', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: { id: 'k2', removed: true } } },
      {
        status: 409,
        body: {
          success: false,
          error: 'Only an unsold key can be removed',
          errorDetail: { code: 'key_not_available', message: 'Only an unsold key can be removed', docsUrl: 'x', param: 'keyId' },
        },
      },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    expect(await getly.products.keys.remove(PID, 'k2')).toEqual({ id: 'k2', removed: true });
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain(`/api/v1/products/${PID}/keys/k2`);
    const err = (await getly.products.keys.remove(PID, KID).catch((e: unknown) => e)) as GetlyError;
    expect(err.code).toBe('key_not_available');
    expect(err.status).toBe(409);
  });

  it('sends keyPoolEnabled / keyPoolLowThreshold on create and update', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 201, body: { success: true, data: { id: PID, keyPoolEnabled: true, keyPoolLowThreshold: 10 } } },
      { body: { success: true, data: { id: PID, keyPoolEnabled: false } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    await getly.products.create({ name: 'Game key', priceCents: 1500, keyPoolEnabled: true, keyPoolLowThreshold: 10 });
    await getly.products.update(PID, { keyPoolEnabled: false });
    expect(JSON.parse(String(calls[0].body))).toMatchObject({ keyPoolEnabled: true, keyPoolLowThreshold: 10 });
    expect(JSON.parse(String(calls[1].body))).toEqual({ keyPoolEnabled: false });
  });
});
