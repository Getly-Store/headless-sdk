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
  it('exposes exactly 19 tools with stable names', () => {
    expect(TOOL_NAMES).toEqual([
      'list_products',
      'get_product',
      'create_product',
      'update_product',
      'publish_product',
      'archive_product',
      'upload_product_file',
      'upload_image',
      'create_blog_post',
      'list_blog_posts',
      'create_coupon',
      'list_coupons',
      'create_checkout_link',
      'get_checkout_link_status',
      'list_licenses',
      'get_sales_stats',
      'search_categories',
      'get_store',
      'get_pay_widget_code',
    ]);
    expect(TOOLS).toHaveLength(19);
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
      create_blog_post: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      list_blog_posts: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      create_coupon: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      list_coupons: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      create_checkout_link: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      get_checkout_link_status: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      list_licenses: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
      get_sales_stats: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
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
