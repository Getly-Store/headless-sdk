import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TOOLS, TOOL_NAMES, MISSING_KEY_MESSAGE } from '../src/tools.js';

function tool(name: string) {
  const t = TOOLS.find((t) => t.name === name);
  if (!t) throw new Error(`tool ${name} not found`);
  return t;
}

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('tool registry', () => {
  it('exposes exactly 30 tools with stable names', () => {
    expect(TOOL_NAMES).toEqual([
      'list_products',
      'get_product',
      'create_product',
      'update_product',
      'publish_product',
      'archive_product',
      'upload_product_file',
      'upload_image',
      'list_product_keys',
      'add_product_keys',
      'remove_product_key',
      'create_blog_post',
      'list_blog_posts',
      'create_coupon',
      'list_coupons',
      'create_checkout_link',
      'get_checkout_link_status',
      'list_licenses',
      'get_sales_stats',
      'list_orders',
      'list_billing_plans',
      'create_billing_plan',
      'update_billing_plan',
      'create_billing_checkout',
      'list_billing_subscriptions',
      'get_billing_subscription',
      'cancel_billing_subscription',
      'search_categories',
      'get_store',
      'get_pay_widget_code',
    ]);
    expect(TOOLS).toHaveLength(30);
  });

  it('annotations snapshot (readOnly / destructive / idempotent hints)', () => {
    const annotations = Object.fromEntries(
      TOOLS.map((t) => [
        t.name,
        {
          readOnlyHint: t.annotations.readOnlyHint ?? false,
          destructiveHint: t.annotations.destructiveHint ?? false,
          idempotentHint: t.annotations.idempotentHint ?? false,
        },
      ]),
    );
    expect(annotations).toEqual({
      list_products: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      get_product: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      create_product: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      update_product: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      publish_product: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      archive_product: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      upload_product_file: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      upload_image: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      list_product_keys: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      add_product_keys: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      remove_product_key: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      create_blog_post: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      list_blog_posts: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      create_coupon: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      list_coupons: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      create_checkout_link: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      get_checkout_link_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      list_licenses: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      get_sales_stats: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      list_orders: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      list_billing_plans: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      create_billing_plan: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      update_billing_plan: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      create_billing_checkout: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      list_billing_subscriptions: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      get_billing_subscription: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      cancel_billing_subscription: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      search_categories: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      get_store: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      get_pay_widget_code: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    });
  });

  it('every tool has a description and an input schema', () => {
    for (const t of TOOLS) {
      expect(t.description.length, t.name).toBeGreaterThan(20);
      expect(t.inputSchema, t.name).toBeTypeOf('object');
    }
  });
});

describe('missing API key', () => {
  beforeEach(() => {
    delete process.env.GETLY_API_KEY;
  });

  it('auth tools return the setup message without touching the network', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network must not be touched');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await tool('list_products').handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(MISSING_KEY_MESSAGE);
    expect(result.content[0].text).toContain('https://www.getly.store/dashboard/developer/keys');
    expect(result.content[0].text).toContain('npx @getly/mcp init');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never suggests passing the key as a tool argument', () => {
    expect(MISSING_KEY_MESSAGE.toLowerCase()).toContain('never pass keys as tool arguments');
  });
});

describe('confirm gates', () => {
  beforeEach(() => {
    process.env.GETLY_API_KEY = 'getly_sk_live_test_0000000000';
  });

  const gateCases: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: 'archive_product', args: { productId: '00000000-0000-4000-8000-000000000001' } },
    { name: 'publish_product', args: { productId: '00000000-0000-4000-8000-000000000001' } },
    {
      name: 'create_coupon',
      args: { code: 'HALF-OFF', type: 'percentage', value: 50 },
    },
    {
      name: 'create_coupon',
      args: { code: 'ALL-FREE', type: 'percentage', value: 100 },
    },
    { name: 'cancel_billing_subscription', args: { subscriptionId: '00000000-0000-4000-8000-000000000002' } },
  ];

  for (const { name, args } of gateCases) {
    it(`${name} (${JSON.stringify(args)}) refuses without confirm and does not call the API`, async () => {
      const fetchSpy = vi.fn(() => {
        throw new Error('API must not be called without confirm');
      });
      vi.stubGlobal('fetch', fetchSpy);

      const result = await tool(name).handler(args);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('REFUSED');
      expect(result.content[0].text).toContain('confirm: true');
      expect(result.content[0].text.toLowerCase()).toContain('ask the human');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it('create_coupon below 50% needs no confirm', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { id: 'c1', code: 'TEN', type: 'percentage', value: 10 } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await tool('create_coupon').handler({ code: 'TEN', type: 'percentage', value: 10 });
    expect(result.isError).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('create_coupon at 95% with confirm passes acknowledgeHighDiscount to the API', async () => {
    let sentBody: Record<string, unknown> | null = null;
    const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ success: true, data: { id: 'c2' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await tool('create_coupon').handler({
      code: 'MEGA',
      type: 'percentage',
      value: 95,
      confirm: true,
    });
    expect(result.isError).toBeUndefined();
    expect(sentBody).not.toBeNull();
    expect(sentBody!.acknowledgeHighDiscount).toBe(true);
  });

  it('fixed coupons never trip the percentage gate (value is cents, not %)', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { id: 'c3' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    // 5000 cents = $50 off — legitimate without confirm.
    const result = await tool('create_coupon').handler({ code: 'FIFTY-BUCKS', type: 'fixed', value: 5000 });
    expect(result.isError).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('API error surfacing', () => {
  beforeEach(() => {
    process.env.GETLY_API_KEY = 'getly_sk_live_test_0000000000';
  });

  it('formats errorDetail (code + hint) into the tool result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: 'Missing scope: read:products',
            errorDetail: {
              code: 'insufficient_scope',
              message: 'Missing scope: read:products',
              hint: 'Create a key with the needed scope.',
              docsUrl: 'https://www.getly.store/developers/api#errors',
            },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const result = await tool('list_products').handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('insufficient_scope');
    expect(result.content[0].text).toContain('HTTP 403');
    expect(result.content[0].text).toContain('Hint: Create a key with the needed scope.');
  });

  it('surfaces publish blockers (422 not_publishable reasons)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: 'Product is not publishable',
            errorDetail: { code: 'not_publishable', message: 'Product is not publishable' },
            reasons: [{ code: 'missing_file', detail: 'Attach at least one downloadable file first.' }],
          }),
          { status: 422, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const result = await tool('publish_product').handler({
      productId: '00000000-0000-4000-8000-000000000001',
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('missing_file');
    expect(result.content[0].text).toContain('Attach at least one downloadable file');
  });
});

describe('get_pay_widget_code', () => {
  beforeEach(() => {
    process.env.GETLY_API_KEY = 'getly_sk_live_test_0000000000';
  });

  function stubStoreThenProduct(product: Record<string, unknown> | null): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/v1/store')) {
        return new Response(JSON.stringify({ success: true, data: { slug: 'maker-studio', name: 'Maker Studio' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('/api/v1/public/stores/')) {
        if (product === null) {
          return new Response(
            JSON.stringify({ success: false, error: 'Product not found', errorDetail: { code: 'not_found', message: 'Product not found' } }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ success: true, data: product }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
  }

  it('returns a canonical popup button snippet for an active product', async () => {
    vi.stubGlobal(
      'fetch',
      stubStoreThenProduct({
        slug: 'neon-ui-kit',
        name: 'Neon UI Kit',
        priceCents: 1900,
        urls: { product: 'https://www.getly.store/product/neon-ui-kit' },
      }),
    );

    const result = await tool('get_pay_widget_code').handler({ productSlug: 'neon-ui-kit' });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as { snippet: string; mode: string; security: string };
    expect(payload.mode).toBe('auto');
    expect(payload.snippet).toContain('<script src="https://www.getly.store/pay.js" async></script>');
    expect(payload.snippet).toContain('data-getly-buy');
    expect(payload.snippet).toContain('data-store="maker-studio"');
    expect(payload.snippet).toContain('data-product="neon-ui-kit"');
    // auto mode omits data-mode (the canonical button).
    expect(payload.snippet).not.toContain('data-mode');
    // Advisory-events honesty note is always present.
    expect(payload.security.toLowerCase()).toContain('advisory');
  });

  it('emits an inline <div> with data-mode="inline"', async () => {
    vi.stubGlobal('fetch', stubStoreThenProduct({ slug: 'neon-ui-kit', name: 'Neon UI Kit', priceCents: 1900 }));
    const result = await tool('get_pay_widget_code').handler({ productSlug: 'neon-ui-kit', mode: 'inline' });
    const payload = JSON.parse(result.content[0].text) as { snippet: string };
    expect(payload.snippet).toContain('<div data-getly-buy');
    expect(payload.snippet).toContain('data-mode="inline"');
  });

  it('refuses a product that is not active/public (404)', async () => {
    vi.stubGlobal('fetch', stubStoreThenProduct(null));
    const result = await tool('get_pay_widget_code').handler({ productSlug: 'ghost' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No ACTIVE public product');
  });

  it('refuses a free/PWYW product (priceCents <= 0)', async () => {
    vi.stubGlobal('fetch', stubStoreThenProduct({ slug: 'freebie', name: 'Freebie', priceCents: 0 }));
    const result = await tool('get_pay_widget_code').handler({ productSlug: 'freebie' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not purchasable through the Pay Widget');
  });
});

describe('orders, licenseType and billing tools', () => {
  beforeEach(() => {
    process.env.GETLY_API_KEY = 'getly_sk_live_test_0000000000';
  });

  function stubJson(body: unknown, status = 200) {
    const spy = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('list_orders projects the buyer email', async () => {
    const spy = stubJson({
      success: true,
      data: [
        {
          id: 'oi1',
          orderId: 'o1',
          price: 900,
          sellerAmount: 810,
          createdAt: '2026-09-23T00:00:00.000Z',
          product: { id: 'p1', name: 'Icons', slug: 'icons' },
          order: { id: 'o1', status: 'completed', buyer: { id: 'u1', name: 'Jane', email: 'jane@example.com' } },
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      hasMore: false,
    });
    const result = await tool('list_orders').handler({ limit: 5 });
    const payload = JSON.parse(result.content[0].text) as { items: Array<Record<string, unknown>>; total: number };
    expect(payload.items[0]).toMatchObject({ orderItemId: 'oi1', buyerEmail: 'jane@example.com', sellerAmountCents: 810 });
    expect(payload.total).toBe(1);
    expect(String(spy.mock.calls[0][0])).toContain('/api/v1/orders?limit=5');
  });

  it('create_product forwards licenseType', async () => {
    const spy = stubJson({ success: true, data: { id: 'p1', name: 'Icons', slug: 'icons', status: 'draft', priceCents: 900, compareAtPriceCents: null, licenseType: 'commercial' } }, 201);
    const result = await tool('create_product').handler({ name: 'Icons', priceCents: 900, licenseType: 'commercial' });
    const body = JSON.parse(String(spy.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body.licenseType).toBe('commercial');
    expect(JSON.parse(result.content[0].text).created.licenseType).toBe('commercial');
  });

  it('create_billing_plan POSTs with an Idempotency-Key', async () => {
    const spy = stubJson({ success: true, data: { id: 'pl1', name: 'Pro', amount: 1900 } }, 201);
    await tool('create_billing_plan').handler({ name: 'Pro', amount: 1900, intervalUnit: 'month' });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/api/v1/billing/plans');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });

  it('create_billing_checkout returns the hosted url', async () => {
    stubJson({ success: true, data: { url: 'https://www.getly.store/billing/subscribe/pl1?t=x', expiresAt: '2026-09-24T00:00:00.000Z' } }, 201);
    const result = await tool('create_billing_checkout').handler({
      planId: '00000000-0000-4000-8000-000000000003',
      customerRef: 'user_1',
      successUrl: 'https://app.example.com/ok',
      cancelUrl: 'https://app.example.com/no',
    });
    expect(JSON.parse(result.content[0].text).url).toContain('/billing/subscribe/');
  });

  it('list_billing_subscriptions passes filters and returns pagination', async () => {
    const spy = stubJson({ success: true, data: [{ id: 's1', status: 'active' }], pagination: { limit: 50, offset: 0, hasMore: false } });
    const result = await tool('list_billing_subscriptions').handler({ status: 'active', customerRef: 'user_1' });
    expect(String(spy.mock.calls[0][0])).toContain('status=active');
    expect(String(spy.mock.calls[0][0])).toContain('customerRef=user_1');
    expect(JSON.parse(result.content[0].text).pagination.hasMore).toBe(false);
  });

  it('billing_not_approved reaches the model with its hint', async () => {
    stubJson(
      {
        success: false,
        error: 'Billing access has not been approved',
        errorDetail: { code: 'billing_not_approved', message: 'Billing access has not been approved', hint: 'Apply at /dashboard/billing.' },
      },
      403,
    );
    const result = await tool('create_billing_plan').handler({ name: 'Pro', amount: 1900, intervalUnit: 'month' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('billing_not_approved');
    expect(result.content[0].text).toContain('/dashboard/billing');
  });

  it('cancel_billing_subscription with confirm POSTs to /cancel', async () => {
    const spy = stubJson({ success: true, data: { id: 's1', cancelAtPeriodEnd: true } });
    const result = await tool('cancel_billing_subscription').handler({ subscriptionId: '00000000-0000-4000-8000-000000000002', confirm: true });
    expect(result.isError).toBeUndefined();
    expect(String(spy.mock.calls[0][0])).toContain('/api/v1/billing/subscriptions/00000000-0000-4000-8000-000000000002/cancel');
  });
});

describe('key pool tools', () => {
  const PID = '00000000-0000-4000-8000-000000000010';
  beforeEach(() => {
    process.env.GETLY_API_KEY = 'getly_sk_live_test_0000000000';
  });

  function stubJson(body: unknown, status = 200) {
    const spy = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  it('list_product_keys passes limit/offset', async () => {
    const spy = stubJson({ success: true, data: { counts: { available: 3, issued: 1, waiting: 0 }, keys: [], total: 4 } });
    const result = await tool('list_product_keys').handler({ productId: PID, limit: 10 });
    expect(String(spy.mock.calls[0][0])).toContain(`/api/v1/products/${PID}/keys?limit=10`);
    expect(JSON.parse(result.content[0].text).counts.available).toBe(3);
  });

  it('add_product_keys POSTs { keys } with an Idempotency-Key', async () => {
    const spy = stubJson({ success: true, data: { added: 2, duplicates: 0, duplicatesInInput: 0, tooLong: 0, blank: 0, filled: 0 } }, 201);
    const result = await tool('add_product_keys').handler({ productId: PID, keys: ['A-1', 'A-2'] });
    const [, init] = spy.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
    expect(JSON.parse(String(init?.body))).toEqual({ keys: ['A-1', 'A-2'] });
    expect(JSON.parse(result.content[0].text).result.added).toBe(2);
    // the tool never echoes the plaintext keys back
    expect(result.content[0].text).not.toContain('A-1');
  });

  it('add_product_keys refuses more than 5000 keys without calling the API', async () => {
    const spy = vi.fn(() => {
      throw new Error('API must not be called');
    });
    vi.stubGlobal('fetch', spy);
    const keys = Array.from({ length: 5001 }, (_, i) => `K-${i}`);
    const result = await tool('add_product_keys').handler({ productId: PID, keys });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('5000');
    expect(spy).not.toHaveBeenCalled();
  });

  it('remove_product_key surfaces key_not_available', async () => {
    stubJson(
      {
        success: false,
        error: 'Only an unsold key can be removed',
        errorDetail: { code: 'key_not_available', message: 'Only an unsold key can be removed', hint: 'Re-read the list.' },
      },
      409,
    );
    const result = await tool('remove_product_key').handler({ productId: PID, keyId: '00000000-0000-4000-8000-000000000011' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('key_not_available');
  });

  it('update_product forwards keyPoolEnabled / keyPoolLowThreshold', async () => {
    const spy = stubJson({ success: true, data: { id: PID, name: 'K', slug: 'k', status: 'draft', priceCents: 900, compareAtPriceCents: null, keyPoolEnabled: true, keyPoolLowThreshold: 10 } });
    const result = await tool('update_product').handler({ productId: PID, keyPoolEnabled: true, keyPoolLowThreshold: 10 });
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ keyPoolEnabled: true, keyPoolLowThreshold: 10 });
    expect(JSON.parse(result.content[0].text).updated).toMatchObject({ keyPoolEnabled: true, keyPoolLowThreshold: 10 });
  });
});
