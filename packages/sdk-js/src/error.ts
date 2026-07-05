/**
 * GetlyError — typed error thrown for every non-2xx v1 API response.
 *
 * Mirrors the platform error envelope:
 *   { success: false, error: string,
 *     errorDetail: { code, message, hint?, docsUrl, param? } }
 * plus the X-RateLimit-* / Retry-After headers.
 */

/** Stable machine-readable error codes (platform registry, api-v1.ts). */
export type GetlyErrorCode =
  | 'unauthorized'
  | 'insufficient_scope'
  | 'rate_limited'
  | 'validation_failed'
  | 'not_found'
  | 'publish_requires_file'
  | 'moderation_locked'
  | 'not_publishable'
  | 'idempotency_conflict'
  | 'coupon_invalid'
  | 'high_discount_ack_required'
  | 'quota_exceeded'
  | 'expired'
  | 'license_invalid'
  | 'activation_limit_reached'
  | 'internal_error';

export interface RateLimitInfo {
  /** X-RateLimit-Limit (null when the header was absent). */
  limit: number | null;
  /** X-RateLimit-Remaining. */
  remaining: number | null;
  /** X-RateLimit-Reset — seconds until the window resets. */
  resetSeconds: number | null;
  /** Retry-After on 429 responses (seconds). */
  retryAfterSeconds: number | null;
}

export interface PublishBlockedReason {
  code: string;
  detail: string;
}

interface ErrorDetail {
  code?: string;
  message?: string;
  hint?: string;
  docsUrl?: string;
  param?: string;
}

const KNOWN_CODES: ReadonlySet<string> = new Set<GetlyErrorCode>([
  'unauthorized',
  'insufficient_scope',
  'rate_limited',
  'validation_failed',
  'not_found',
  'publish_requires_file',
  'moderation_locked',
  'not_publishable',
  'idempotency_conflict',
  'coupon_invalid',
  'high_discount_ack_required',
  'quota_exceeded',
  'expired',
  'license_invalid',
  'activation_limit_reached',
  'internal_error',
]);

/** Fallback for legacy v1 routes that only send the plain `error` string. */
function codeFromStatus(status: number): GetlyErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'insufficient_scope';
    case 404:
      return 'not_found';
    case 429:
      return 'rate_limited';
    case 400:
    case 409:
    case 422:
      return 'validation_failed';
    default:
      return 'internal_error';
  }
}

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Parse the X-RateLimit-* / Retry-After headers of any v1 response. */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  return {
    limit: headerNumber(headers, 'X-RateLimit-Limit'),
    remaining: headerNumber(headers, 'X-RateLimit-Remaining'),
    resetSeconds: headerNumber(headers, 'X-RateLimit-Reset'),
    retryAfterSeconds: headerNumber(headers, 'Retry-After'),
  };
}

export class GetlyError extends Error {
  /** HTTP status of the response (0 for client-side errors). */
  readonly status: number;
  /** Stable machine code — branch on this, not on the message. */
  readonly code: GetlyErrorCode;
  /** LLM/human-actionable hint from the API (what to DO next). */
  readonly hint?: string;
  readonly docsUrl?: string;
  /** Offending field name for validation_failed / missing scope name. */
  readonly param?: string;
  /** Rate-limit snapshot from the error response headers. */
  readonly rateLimit: RateLimitInfo;
  /** Machine-readable publish blockers (422 not_publishable only). */
  readonly reasons?: PublishBlockedReason[];

  constructor(
    message: string,
    opts: {
      status: number;
      code: GetlyErrorCode;
      hint?: string;
      docsUrl?: string;
      param?: string;
      rateLimit?: Partial<RateLimitInfo>;
      reasons?: PublishBlockedReason[];
    },
  ) {
    super(message);
    this.name = 'GetlyError';
    this.status = opts.status;
    this.code = opts.code;
    this.hint = opts.hint;
    this.docsUrl = opts.docsUrl;
    this.param = opts.param;
    this.rateLimit = {
      limit: opts.rateLimit?.limit ?? null,
      remaining: opts.rateLimit?.remaining ?? null,
      resetSeconds: opts.rateLimit?.resetSeconds ?? null,
      retryAfterSeconds: opts.rateLimit?.retryAfterSeconds ?? null,
    };
    this.reasons = opts.reasons;
  }

  /** Build a GetlyError from a parsed error body + response headers. */
  static fromResponse(status: number, body: unknown, headers: Headers): GetlyError {
    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const detail = (record.errorDetail && typeof record.errorDetail === 'object'
      ? record.errorDetail
      : {}) as ErrorDetail;
    const rawCode = typeof detail.code === 'string' ? detail.code : undefined;
    const code: GetlyErrorCode =
      rawCode && KNOWN_CODES.has(rawCode) ? (rawCode as GetlyErrorCode) : codeFromStatus(status);
    const message =
      (typeof detail.message === 'string' && detail.message) ||
      (typeof record.error === 'string' && record.error) ||
      `Getly API error (HTTP ${status})`;
    const reasons = Array.isArray(record.reasons)
      ? (record.reasons as PublishBlockedReason[])
      : undefined;
    return new GetlyError(message, {
      status,
      code,
      hint: typeof detail.hint === 'string' ? detail.hint : undefined,
      docsUrl: typeof detail.docsUrl === 'string' ? detail.docsUrl : undefined,
      param: typeof detail.param === 'string' ? detail.param : undefined,
      rateLimit: parseRateLimitHeaders(headers),
      reasons,
    });
  }
}
