import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebhookSignature, parseSignatureHeader } from '../src/index.js';

const SECRET = 'whsec_test_secret_0123456789abcdef';
const PAYLOAD = JSON.stringify({
  deliveryId: 'd1',
  event: 'sale.completed',
  data: { orderId: 'o1', amountCents: 1900 },
  timestamp: '2026-07-04T12:00:00.000Z',
});
const T = 1_700_000_000;

function sign(secret: string, payload: string, t: number): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature within tolerance', () => {
    const header = sign(SECRET, PAYLOAD, T);
    expect(
      verifyWebhookSignature({ payload: PAYLOAD, header, secret: SECRET, now: T + 100 }),
    ).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const header = sign(SECRET, PAYLOAD, T);
    const tampered = PAYLOAD.replace('1900', '1');
    expect(
      verifyWebhookSignature({ payload: tampered, header, secret: SECRET, now: T + 100 }),
    ).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const header = sign('other_secret', PAYLOAD, T);
    expect(
      verifyWebhookSignature({ payload: PAYLOAD, header, secret: SECRET, now: T + 100 }),
    ).toBe(false);
  });

  it('rejects an expired timestamp (default 300s tolerance)', () => {
    const header = sign(SECRET, PAYLOAD, T);
    expect(
      verifyWebhookSignature({ payload: PAYLOAD, header, secret: SECRET, now: T + 301 }),
    ).toBe(false);
    // Boundary: exactly 300s is still accepted.
    expect(
      verifyWebhookSignature({ payload: PAYLOAD, header, secret: SECRET, now: T + 300 }),
    ).toBe(true);
  });

  it('rejects future timestamps outside tolerance (replay w/ clock skew)', () => {
    const header = sign(SECRET, PAYLOAD, T + 1000);
    expect(
      verifyWebhookSignature({ payload: PAYLOAD, header, secret: SECRET, now: T }),
    ).toBe(false);
  });

  it('honors a custom toleranceSec', () => {
    const header = sign(SECRET, PAYLOAD, T);
    expect(
      verifyWebhookSignature({ payload: PAYLOAD, header, secret: SECRET, toleranceSec: 10, now: T + 11 }),
    ).toBe(false);
  });

  it('rejects malformed / missing headers without throwing', () => {
    for (const header of [null, undefined, '', 'garbage', 't=abc,v1=00', 'v1=00', `t=${T}`, `t=${T},v1=nothex!`]) {
      expect(
        verifyWebhookSignature({ payload: PAYLOAD, header, secret: SECRET, now: T }),
      ).toBe(false);
    }
  });

  it('rejects a truncated v1 (length mismatch, timing-safe path)', () => {
    const good = sign(SECRET, PAYLOAD, T);
    const truncated = good.slice(0, good.length - 10);
    expect(
      verifyWebhookSignature({ payload: PAYLOAD, header: truncated, secret: SECRET, now: T }),
    ).toBe(false);
  });
});

describe('parseSignatureHeader', () => {
  it('parses t and v1 regardless of order and whitespace', () => {
    expect(parseSignatureHeader('v1=deadbeef, t=123')).toEqual({ t: 123, v1: 'deadbeef' });
  });
  it('returns null when a component is missing', () => {
    expect(parseSignatureHeader('t=123')).toBeNull();
    expect(parseSignatureHeader('v1=deadbeef')).toBeNull();
  });
});
