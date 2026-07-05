/**
 * Webhook signature verification for the timestamped `X-Getly-Signature-V2`
 * header (Stripe-style):
 *
 *   X-Getly-Signature-V2: t=<unixSeconds>,v1=<hex hmacSha256(secret, `${t}.${payload}`)>
 *
 * Verification: recompute the HMAC over `${t}.${rawBody}` and compare with a
 * timing-safe comparison, then reject if |now - t| exceeds the tolerance
 * (300s default) to block replay of captured deliveries.
 *
 * Uses node:crypto — Node >= 18 (and every serverless Node runtime). Pure
 * WebCrypto edge support is on the roadmap (WebCrypto HMAC is async, which
 * would change this function's signature).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyWebhookSignatureInput {
  /** EXACT raw request body string (await req.text() — do NOT re-serialize). */
  payload: string;
  /** The X-Getly-Signature-V2 header value. */
  header: string | null | undefined;
  /** The endpoint's HMAC secret (returned once at endpoint creation). */
  secret: string;
  /** Max allowed |now - t| in seconds. Default 300 (5 minutes). */
  toleranceSec?: number;
  /** Override "now" (unix seconds) — for tests. */
  now?: number;
}

/** Parse `t=...,v1=...` — returns null on any malformation. */
export function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) t = Number(value);
    else if (key === 'v1' && /^[0-9a-f]+$/i.test(value)) v1 = value.toLowerCase();
  }
  if (t === null || v1 === null) return null;
  return { t, v1 };
}

/**
 * Verify an X-Getly-Signature-V2 header against the raw payload.
 * Returns true only when the HMAC matches (timing-safe) AND the timestamp is
 * within the tolerance window.
 */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): boolean {
  const { payload, header, secret } = input;
  if (!header || !secret || typeof payload !== 'string') return false;

  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  const toleranceSec = input.toleranceSec ?? 300;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.t) > toleranceSec) return false;

  const expectedHex = createHmac('sha256', secret)
    .update(`${parsed.t}.${payload}`)
    .digest('hex');

  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(parsed.v1, 'hex');
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/** Webhook delivery body shape (what Getly POSTs to your endpoint). */
export interface GetlyWebhookEvent<T = Record<string, unknown>> {
  deliveryId?: string;
  /** e.g. 'sale.completed', 'order.refunded', 'checkout_link.completed'. */
  event: string;
  data: T;
  timestamp?: string;
}
