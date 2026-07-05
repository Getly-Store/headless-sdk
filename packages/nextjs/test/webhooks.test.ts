import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Webhooks } from '../src/index.js';

const SECRET = 'whsec_next_test_secret';

function makeBody(event: string, data: Record<string, unknown>): string {
  return JSON.stringify({
    deliveryId: 'del_1',
    event,
    data,
    timestamp: new Date().toISOString(),
  });
}

function signV2(payload: string, secret = SECRET, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

function postRequest(payload: string, signature?: string): Request {
  return new Request('https://example.com/api/webhooks/getly', {
    method: 'POST',
    headers: signature ? { 'X-Getly-Signature-V2': signature } : {},
    body: payload,
  });
}

describe('Webhooks()', () => {
  it('dispatches sale.completed to the typed handler on a valid signature', async () => {
    const onSaleCompleted = vi.fn();
    const onEvent = vi.fn();
    const handler = Webhooks({ secret: SECRET, onSaleCompleted, onEvent });

    const payload = makeBody('sale.completed', {
      orderId: 'o1',
      checkoutLinkId: 'cl1',
      reference: 'tg-42',
      amountCents: 1900,
    });
    const res = await handler(postRequest(payload, signV2(payload)));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ received: true });
    expect(onSaleCompleted).toHaveBeenCalledOnce();
    expect(onSaleCompleted.mock.calls[0][0]).toMatchObject({ orderId: 'o1', reference: 'tg-42' });
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0][0]).toMatchObject({ event: 'sale.completed', deliveryId: 'del_1' });
  });

  it('401s an invalid signature and never calls handlers', async () => {
    const onSaleCompleted = vi.fn();
    const handler = Webhooks({ secret: SECRET, onSaleCompleted });

    const payload = makeBody('sale.completed', { orderId: 'o1' });
    const res = await handler(postRequest(payload, signV2(payload, 'wrong_secret')));

    expect(res.status).toBe(401);
    expect(onSaleCompleted).not.toHaveBeenCalled();
  });

  it('401s a missing signature header', async () => {
    const handler = Webhooks({ secret: SECRET });
    const payload = makeBody('sale.completed', {});
    const res = await handler(postRequest(payload));
    expect(res.status).toBe(401);
  });

  it('401s a stale signature (outside the 300s tolerance)', async () => {
    const onSaleCompleted = vi.fn();
    const handler = Webhooks({ secret: SECRET, onSaleCompleted });

    const payload = makeBody('sale.completed', {});
    const staleT = Math.floor(Date.now() / 1000) - 400;
    const res = await handler(postRequest(payload, signV2(payload, SECRET, staleT)));

    expect(res.status).toBe(401);
    expect(onSaleCompleted).not.toHaveBeenCalled();
  });

  it('200s a verified event with no matching handler', async () => {
    const handler = Webhooks({ secret: SECRET, onSaleCompleted: vi.fn() });
    const payload = makeBody('review.created', { reviewId: 'r1' });
    const res = await handler(postRequest(payload, signV2(payload)));
    expect(res.status).toBe(200);
  });

  it('routes each typed event to its own handler', async () => {
    const onOrderRefunded = vi.fn();
    const onCheckoutLinkCompleted = vi.fn();
    const onLicenseActivated = vi.fn();
    const handler = Webhooks({ secret: SECRET, onOrderRefunded, onCheckoutLinkCompleted, onLicenseActivated });

    for (const event of ['order.refunded', 'checkout_link.completed', 'license.activated']) {
      const payload = makeBody(event, { id: event });
      const res = await handler(postRequest(payload, signV2(payload)));
      expect(res.status).toBe(200);
    }
    expect(onOrderRefunded).toHaveBeenCalledOnce();
    expect(onCheckoutLinkCompleted).toHaveBeenCalledOnce();
    expect(onLicenseActivated).toHaveBeenCalledOnce();
  });

  it('500s (retriable) when a user handler throws', async () => {
    const handler = Webhooks({
      secret: SECRET,
      onSaleCompleted: () => {
        throw new Error('db down');
      },
    });
    const payload = makeBody('sale.completed', {});
    const res = await handler(postRequest(payload, signV2(payload)));
    expect(res.status).toBe(500);
  });

  it('400s a verified but unparseable payload', async () => {
    const handler = Webhooks({ secret: SECRET });
    const payload = 'not-json';
    const res = await handler(postRequest(payload, signV2(payload)));
    expect(res.status).toBe(400);
  });

  it('throws at build time when secret is missing', () => {
    expect(() => Webhooks({ secret: '' })).toThrow(/secret is required/);
  });
});
