import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  Getly,
  GetlyError,
  SDK_VERSION,
  WEBHOOK_EVENT_TYPES,
  isWebhookEvent,
  type TypedGetlyWebhookEvent,
} from '../src/index.js';
import { scriptedFetch } from './helpers.js';

const KEY = 'getly_sk_live_' + 'c'.repeat(64);
const PLAN_ID = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const SUB_ID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';

const plan = {
  id: PLAN_ID,
  name: 'Pro',
  description: null,
  amount: 1900,
  amountCents: 1900,
  currency: 'usd',
  interval: { unit: 'month', count: 1 },
  externalId: 'pro-monthly',
  isActive: true,
  createdAt: '2026-09-08T09:00:00.000Z',
};

const sub = {
  id: SUB_ID,
  planId: PLAN_ID,
  customerRef: 'user_8841',
  status: 'active',
  paymentMethod: 'paypal',
  currentPeriodStart: '2026-09-08T09:14:00.000Z',
  currentPeriodEnd: '2026-10-08T09:14:00.000Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  endedAt: null,
  createdAt: '2026-09-08T09:14:00.000Z',
  metadata: null,
};

describe('SDK_VERSION', () => {
  it('matches package.json (it is sent as X-Getly-Client)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(SDK_VERSION).toBe(pkg.version);
  });
});

describe('billing.plans', () => {
  it('lists with the active filter as a string query param', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ body: { success: true, data: [plan] } }]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const plans = await getly.billing.plans.list({ active: true });
    expect(plans[0].amountCents).toBe(1900);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/api/v1/billing/plans?active=true');
  });

  it('creates with an automatic Idempotency-Key', async () => {
    const { fetchImpl, calls } = scriptedFetch([{ status: 201, body: { success: true, data: plan } }]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const created = await getly.billing.plans.create({ name: 'Pro', amount: 1900, intervalUnit: 'month', externalId: 'pro-monthly' });
    expect(created.id).toBe(PLAN_ID);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['idempotency-key']).toBeTruthy();
    expect(JSON.parse(String(calls[0].body))).toEqual({ name: 'Pro', amount: 1900, intervalUnit: 'month', externalId: 'pro-monthly' });
  });

  it('gets and patches one plan', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: plan } },
      { body: { success: true, data: { ...plan, amount: 2400, amountCents: 2400 } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    await getly.billing.plans.get(PLAN_ID);
    const updated = await getly.billing.plans.update(PLAN_ID, { amount: 2400 });
    expect(updated.amount).toBe(2400);
    expect(calls[0].url).toContain(`/api/v1/billing/plans/${PLAN_ID}`);
    expect(calls[1].method).toBe('PATCH');
  });

  it('surfaces billing_not_approved as a typed error with details', async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 403,
        body: {
          success: false,
          error: 'Billing access has not been approved',
          errorDetail: { code: 'billing_not_approved', message: 'Billing access has not been approved', docsUrl: 'x', accessStatus: 'pending' },
        },
      },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const err = (await getly.billing.plans.create({ name: 'Pro', amount: 1900, intervalUnit: 'month' }).catch((e: unknown) => e)) as GetlyError;
    expect(err).toBeInstanceOf(GetlyError);
    expect(err.code).toBe('billing_not_approved');
    expect(err.details).toEqual({ accessStatus: 'pending' });
  });
});

describe('billing checkout + subscriptions', () => {
  it('mints a hosted subscribe page', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 201, body: { success: true, data: { url: 'https://www.getly.store/billing/subscribe/x?t=y', expiresAt: '2026-09-09T09:00:00.000Z' } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const out = await getly.billing.createCheckout({
      planId: PLAN_ID,
      customerRef: 'user_8841',
      successUrl: 'https://app.example.com/ok',
      cancelUrl: 'https://app.example.com/no',
    });
    expect(out.url).toContain('/billing/subscribe/');
    expect(calls[0].url).toContain('/api/v1/billing/checkout');
  });

  it('lists with limit/offset pagination and iterates all pages', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: [sub], pagination: { limit: 1, offset: 0, hasMore: true } } },
      { body: { success: true, data: [{ ...sub, id: 'other' }], pagination: { limit: 1, offset: 1, hasMore: false } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const ids: string[] = [];
    for await (const s of getly.billing.subscriptions.iterate({ limit: 1, customerRef: 'user_8841' })) ids.push(s.id);
    expect(ids).toEqual([SUB_ID, 'other']);
    expect(calls[0].url).toContain('customerRef=user_8841');
    expect(calls[0].url).toContain('offset=0');
    expect(calls[1].url).toContain('offset=1');
  });

  it('gets and cancels a subscription', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: sub } },
      { body: { success: true, data: { ...sub, cancelAtPeriodEnd: true } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    expect((await getly.billing.subscriptions.get(SUB_ID)).status).toBe('active');
    const canceled = await getly.billing.subscriptions.cancel(SUB_ID);
    expect(canceled.cancelAtPeriodEnd).toBe(true);
    expect(calls[1].method).toBe('POST');
    expect(calls[1].url).toContain(`/api/v1/billing/subscriptions/${SUB_ID}/cancel`);
  });
});

describe('products.licenseType, listFiles, analytics, orders buyer email', () => {
  it('sends licenseType on create and null on update', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 201, body: { success: true, data: { id: 'p1', licenseType: 'commercial' } } },
      { body: { success: true, data: { id: 'p1', licenseType: null } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    await getly.products.create({ name: 'Icons', priceCents: 900, licenseType: 'commercial' });
    await getly.products.update('p1', { licenseType: null });
    expect(JSON.parse(String(calls[0].body)).licenseType).toBe('commercial');
    expect(JSON.parse(String(calls[1].body))).toEqual({ licenseType: null });
  });

  it('lists product files', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: [{ id: 'f1', fileName: 'a.zip', fileSize: 5, fileType: 'application/zip', isLatest: true, createdAt: 'x' }] } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const files = await getly.products.listFiles('p1');
    expect(files).toHaveLength(1);
    expect(calls[0].url).toContain('/api/v1/products/p1/files');
    expect(calls[0].method).toBe('GET');
  });

  it('reads analytics', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: { totalSales: 3, totalRevenue: 2700, monthlySales: 1, monthlyRevenue: 900, averageOrderValue: 900, productCount: 2, totalDownloads: 5, salesByMonth: [] } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    expect((await getly.analytics.get()).totalRevenue).toBe(2700);
    expect(calls[0].url).toContain('/api/v1/analytics');
  });

  it('passes the buyer email through on an order', async () => {
    const { fetchImpl } = scriptedFetch([
      { body: { success: true, data: { id: 'o1', buyerId: 'u1', buyerEmail: 'jane@example.com', buyer: { id: 'u1', name: 'Jane', email: 'jane@example.com' }, status: 'completed', total: 900, createdAt: 'x', items: [] } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const order = await getly.orders.get('11111111-1111-1111-1111-111111111111');
    expect(order.buyerEmail).toBe('jane@example.com');
    expect(order.buyer?.email).toBe('jane@example.com');
  });
});

describe('publicCheckout (no API key)', () => {
  it('mints without Authorization and without an Idempotency-Key', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: { method: 'paypal', url: 'https://www.paypal.com/checkoutnow?token=T', linkId: 'l1', priceCents: 2900, currency: 'USD' } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const out = await getly.publicCheckout.create({ storeSlug: 's', productSlug: 'p', method: 'paypal', email: 'b@example.com' });
    expect(out.method).toBe('paypal');
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].headers['idempotency-key']).toBeUndefined();
    expect(JSON.parse(String(calls[0].body))).toMatchObject({ method: 'paypal', email: 'b@example.com' });
  });

  it('exposes the live rails on payment_method_unavailable', async () => {
    const { fetchImpl } = scriptedFetch([
      {
        status: 409,
        body: {
          success: false,
          error: 'card payments are not available right now',
          errorDetail: { code: 'payment_method_unavailable', message: 'card payments are not available right now', docsUrl: 'x', paymentMethods: ['paypal', 'crypto'] },
        },
      },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const err = (await getly.publicCheckout.create({ storeSlug: 's', productSlug: 'p', method: 'card' }).catch((e: unknown) => e)) as GetlyError;
    expect(err.code).toBe('payment_method_unavailable');
    expect(err.details.paymentMethods).toEqual(['paypal', 'crypto']);
  });

  it('check sends check:true; status polls the link', async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { body: { success: true, data: { check: 'ok', productName: 'P', productSlug: 'p', priceCents: 900, currency: 'USD', origin: null, paymentMethods: ['paypal', 'crypto'], note: 'n' } } },
      { body: { success: true, data: { status: 'completed' } } },
    ]);
    const getly = new Getly({ apiKey: KEY, fetch: fetchImpl });
    const check = await getly.publicCheckout.check({ storeSlug: 's', productSlug: 'p' });
    expect(check.paymentMethods).toEqual(['paypal', 'crypto']);
    expect(JSON.parse(String(calls[0].body)).check).toBe(true);
    expect((await getly.publicCheckout.status('l1')).status).toBe('completed');
    expect(calls[1].url).toContain('/api/v1/public/checkout/l1/status');
  });
});

describe('webhook event registry', () => {
  it('matches the live list: billing.* present, removed events gone', () => {
    expect(WEBHOOK_EVENT_TYPES).toContain('billing.subscription.renewed');
    expect(WEBHOOK_EVENT_TYPES).toContain('dispute.resolved');
    const names = WEBHOOK_EVENT_TYPES as readonly string[];
    expect(names).not.toContain('refund.completed');
    expect(names).not.toContain('subscription.created');
    expect(names).not.toContain('subscription.cancelled');
    expect(WEBHOOK_EVENT_TYPES).toHaveLength(18);
  });

  it('matches the x-webhooks event list in the OpenAPI snapshot', () => {
    const spec = readFileSync(new URL('../../../openapi/getly-v1.yaml', import.meta.url), 'utf8');
    const block = spec.slice(spec.indexOf('    events:\n'), spec.indexOf('servers:'));
    const listed = [...block.matchAll(/^ {6}- ([a-z_.]+)$/gm)].map((m) => m[1]);
    expect(listed).toEqual([...WEBHOOK_EVENT_TYPES]);
  });

  it('narrows the payload by event name', () => {
    const evt = {
      deliveryId: 'd1',
      event: 'sale.completed',
      data: { orderId: 'o1', buyerId: 'u1', buyerEmail: 'jane@example.com', items: [{ orderItemId: 'i1', productId: 'p1', price: 900, sellerAmount: 810, isGift: false, licenseKey: 'AAAA-0001' }], total: 900 },
      timestamp: 't',
    } as TypedGetlyWebhookEvent;
    if (isWebhookEvent(evt, 'sale.completed')) {
      expect(evt.data.buyerEmail).toBe('jane@example.com');
      expect(evt.data.items[0].orderItemId).toBe('i1');
      expect(evt.data.items[0].licenseKey).toBe('AAAA-0001');
    } else {
      throw new Error('guard failed');
    }
  });
});
