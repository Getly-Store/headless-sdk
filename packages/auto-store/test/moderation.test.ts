import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Getly } from '@getly/sdk';
import { runAutoStore } from '../src/run.js';
import {
  fakeAnthropic,
  fakeFetch,
  makeFixtureFolder,
  rmrf,
  SAMPLE_TREE,
  type RecordedCall,
} from './helpers.js';

let dir: string;

beforeAll(async () => {
  dir = await makeFixtureFolder();
});

afterAll(async () => {
  await rmrf(dir);
});

const PRODUCT = {
  id: 'p1',
  slug: 'minimal-icon-pack-x1',
  name: 'Minimal Icon Pack',
  status: 'draft',
  priceCents: 900,
  urls: {
    product: 'https://www.getly.store/product/minimal-icon-pack-x1',
    buy: 'https://www.getly.store/product/minimal-icon-pack-x1',
    embed: 'https://www.getly.store/embed/product/p1',
  },
};

/** Every route of the full pipeline except publish/checkout (per-test). */
function baseRoutes() {
  return {
    'GET /api/categories': { json: { success: true, data: SAMPLE_TREE } },
    'GET /api/v1/store': {
      json: { success: true, data: { id: 's1', name: 'My Store', slug: 'my-store' } },
    },
    'POST /api/v1/uploads/images/presign': {
      json: {
        success: true,
        data: {
          uploadUrl: 'https://r2.example.com/img-put',
          publicUrl: 'https://cdn.getly.example/images/preview.png',
          expiresIn: 3600,
        },
      },
    },
    'PUT /img-put': { json: {} },
    // NOTE: listed before the attach route — fakeFetch matches by prefix.
    'POST /api/v1/products/p1/files/presign': {
      json: {
        success: true,
        data: {
          uploadUrl: 'https://r2.example.com/file-put',
          fileUrl: 'https://cdn.getly.example/files/pack.zip',
          key: 'files/u1/abc.zip',
          fileName: 'pack.zip',
          fileSize: 9,
        },
      },
    },
    'PUT /file-put': { json: {} },
    'POST /api/v1/products/p1/files': { json: { success: true, data: { id: 'f1' } } },
    // NB: the generic 'POST /api/v1/products' create route is added LAST in
    // each test — fakeFetch matches by prefix in insertion order, and the
    // create path is a prefix of every /products/p1/* path above.
  };
}

function productCreateRoute() {
  return { json: { success: true, data: PRODUCT }, status: 201 };
}

describe('moderation-aware publish', () => {
  it('reports "awaiting review" honestly and skips the checkout link', async () => {
    const routes: Record<string, { status?: number; json?: unknown }> = {
      ...baseRoutes(),
      'POST /api/v1/products/p1/publish': {
        json: {
          success: true,
          data: {
            ...PRODUCT,
            status: 'pending_review',
            moderationStatus: 'pending_review',
            note: 'New stores are reviewed before their first product goes live.',
          },
        },
      },
      'POST /api/v1/posts': {
        json: { success: true, data: { id: 'post1', slug: 'designing-a-minimal-icon-set', title: 'x', status: 'published', excerpt: null } },
        status: 201,
      },
      'POST /api/v1/products': productCreateRoute(),
    };
    const { impl, calls } = fakeFetch(routes);

    const getly = new Getly({ apiKey: 'getly_sk_live_test', fetch: impl });
    const lines: string[] = [];

    const result = await runAutoStore(
      { folder: dir, yes: true },
      { getly, fetchImpl: impl, anthropic: fakeAnthropic(), log: (l) => lines.push(l), confirm: async () => true },
    );

    const output = lines.join('\n');
    expect(result.status).toBe('awaiting-review');
    expect(output.toLowerCase()).toContain('awaiting review');
    expect(output).toContain('NOT live');
    expect(output).toContain('New stores are reviewed');
    // Never pretend: no "LIVE" claim, no checkout link.
    expect(output).not.toContain('Product is LIVE');
    expect(calls.some((c) => c.url.includes('/api/v1/checkout-links'))).toBe(false);
    expect(output).toContain('Checkout link skipped');

    // The blog post got the REAL slug substituted for the placeholder.
    const postCall = calls.find((c) => c.method === 'POST' && c.url.includes('/api/v1/posts'));
    expect(postCall).toBeDefined();
    const postBody = postCall!.body as { contentMarkdown: string; status: string };
    expect(postBody.contentMarkdown).toContain('[product:minimal-icon-pack-x1]');
    expect(postBody.contentMarkdown).not.toContain('PRODUCT_SLUG');
    expect(postBody.status).toBe('published');

    // Conventions: Bearer auth + Idempotency-Key on the create.
    const createCall = calls.find(
      (c) => c.method === 'POST' && new URL(c.url).pathname === '/api/v1/products',
    ) as RecordedCall;
    expect(createCall.headers.authorization).toBe('Bearer getly_sk_live_test');
    expect(createCall.headers['idempotency-key']).toMatch(/^autostore-product-/);
    const createBody = createCall.body as Record<string, unknown>;
    expect(createBody.priceCents).toBe(900);
    expect(createBody.status).toBe('draft');
    expect(createBody.categoryId).toBe('cat-icons');
  });

  it('prints machine-readable blockers when publish returns 422 not_publishable', async () => {
    const routes: Record<string, { status?: number; json?: unknown }> = {
      ...baseRoutes(),
      'POST /api/v1/products/p1/publish': {
        status: 422,
        json: {
          success: false,
          error: 'Product is not publishable',
          errorDetail: {
            code: 'not_publishable',
            message: 'Product is not publishable',
            hint: 'Fix every entry in `reasons`.',
          },
          reasons: [
            { code: 'missing_file', detail: 'Attach at least one downloadable file first.' },
          ],
        },
      },
      'POST /api/v1/posts': {
        json: { success: true, data: { id: 'post1', slug: 'post-slug', title: 'x', status: 'published', excerpt: null } },
        status: 201,
      },
      'POST /api/v1/products': productCreateRoute(),
    };
    const { impl, calls } = fakeFetch(routes);
    const getly = new Getly({ apiKey: 'getly_sk_live_test', fetch: impl });
    const lines: string[] = [];

    const result = await runAutoStore(
      { folder: dir, yes: true },
      { getly, fetchImpl: impl, anthropic: fakeAnthropic(), log: (l) => lines.push(l), confirm: async () => true },
    );

    expect(result.status).toBe('draft');
    expect(result.publishBlockers).toEqual([
      { code: 'missing_file', detail: 'Attach at least one downloadable file first.' },
    ]);
    const output = lines.join('\n');
    expect(output).toContain('Publish blocked');
    expect(output).toContain('missing_file');
    expect(calls.some((c) => c.url.includes('/api/v1/checkout-links'))).toBe(false);
  });

  it('creates the checkout link when the product goes live', async () => {
    const routes: Record<string, { status?: number; json?: unknown }> = {
      ...baseRoutes(),
      'POST /api/v1/products/p1/publish': {
        json: { success: true, data: { ...PRODUCT, status: 'active' } },
      },
      'POST /api/v1/posts': {
        json: { success: true, data: { id: 'post1', slug: 'post-slug', title: 'x', status: 'published', excerpt: null } },
        status: 201,
      },
      'POST /api/v1/checkout-links': {
        status: 201,
        json: {
          success: true,
          data: {
            id: 'cl1',
            url: 'https://www.getly.store/go/cl1',
            productId: 'p1',
            status: 'open',
            priceCents: 900,
            discountedPriceCents: 900,
            couponApplied: false,
            expiresAt: null,
          },
        },
      },
      'POST /api/v1/products': productCreateRoute(),
    };
    const { impl, calls } = fakeFetch(routes);
    const getly = new Getly({ apiKey: 'getly_sk_live_test', fetch: impl });
    const lines: string[] = [];

    const result = await runAutoStore(
      { folder: dir, yes: true },
      { getly, fetchImpl: impl, anthropic: fakeAnthropic(), log: (l) => lines.push(l), confirm: async () => true },
    );

    expect(result.status).toBe('live');
    expect(result.checkoutLink?.url).toBe('https://www.getly.store/go/cl1');
    const output = lines.join('\n');
    expect(output).toContain('Product is LIVE');
    expect(output).toContain('https://www.getly.store/go/cl1');
    expect(output).toContain('https://www.getly.store/product/minimal-icon-pack-x1');
    // Uploaded 1 image and 3 non-image files, individually (no zipping).
    expect(output).toContain('no zipping');
    const putCalls = calls.filter((c) => c.method === 'PUT');
    expect(putCalls.length).toBe(4); // 1 image + 3 product files
  });
});
