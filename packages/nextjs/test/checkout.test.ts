import { describe, it, expect } from 'vitest';
import { Checkout } from '../src/index.js';

const KEY = 'getly_sk_live_' + 'c'.repeat(64);

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Fetch mock emulating POST /api/v1/checkout-links. */
function checkoutLinkFetch(overrides: { status?: number; body?: unknown } = {}) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    calls.push({ url, method: init?.method ?? 'GET', headers, body: init?.body ? JSON.parse(init.body as string) : null });
    const body =
      overrides.body ??
      {
        success: true,
        data: {
          id: 'cl_1',
          url: 'https://www.getly.store/go/cl_1',
          productId: 'prod_1',
          status: 'open',
          priceCents: 1900,
          discountedPriceCents: 1900,
          couponApplied: false,
          currency: 'USD',
          reference: null,
          metadata: null,
          orderId: null,
          expiresAt: '2026-07-11T00:00:00.000Z',
          createdAt: '2026-07-04T00:00:00.000Z',
          completedAt: null,
        },
      };
    return new Response(JSON.stringify(body), {
      status: overrides.status ?? 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

describe('Checkout()', () => {
  it('creates a checkout link server-side and 303-redirects to it', async () => {
    const { fetchImpl, calls } = checkoutLinkFetch();
    const handler = Checkout({ apiKey: KEY, productId: 'prod_1', fetch: fetchImpl });

    const res = await handler(new Request('https://myshop.example/api/buy'));

    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('https://www.getly.store/go/cl_1');
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/api/v1/checkout-links');
    expect(calls[0].body).toMatchObject({ productId: 'prod_1' });
    expect(calls[0].headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('passes coupon / successUrl / reference through to the create call', async () => {
    const { fetchImpl, calls } = checkoutLinkFetch();
    const handler = Checkout({
      apiKey: KEY,
      productId: 'prod_1',
      coupon: 'LAUNCH50',
      successUrl: 'https://myshop.example/thanks',
      reference: (req) => new URL(req.url).searchParams.get('uid') ?? 'anon',
      fetch: fetchImpl,
    });

    await handler(new Request('https://myshop.example/api/buy?uid=tg-99'));

    expect(calls[0].body).toMatchObject({
      productId: 'prod_1',
      couponCode: 'LAUNCH50',
      successUrl: 'https://myshop.example/thanks',
      reference: 'tg-99',
    });
  });

  it('supports a per-request options function returning a full create input', async () => {
    const { fetchImpl, calls } = checkoutLinkFetch();
    const handler = Checkout({
      apiKey: KEY,
      productId: (req) => ({
        productId: new URL(req.url).searchParams.get('product')!,
        metadata: { source: 'landing' },
      }),
      fetch: fetchImpl,
    });

    const res = await handler(new Request('https://myshop.example/api/buy?product=prod_9'));

    expect(res.status).toBe(303);
    expect(calls[0].body).toMatchObject({ productId: 'prod_9', metadata: { source: 'landing' } });
  });

  it('returns a safe 502 (no key leak) when the API errors', async () => {
    const { fetchImpl } = checkoutLinkFetch({
      status: 409,
      body: {
        success: false,
        error: "Product status is 'draft'",
        errorDetail: { code: 'not_publishable', message: "Product status is 'draft'" },
      },
    });
    const handler = Checkout({ apiKey: KEY, productId: 'prod_1', fetch: fetchImpl });

    const res = await handler(new Request('https://myshop.example/api/buy'));

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Checkout unavailable (not_publishable)');
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
});
