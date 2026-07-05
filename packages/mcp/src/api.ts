/**
 * Minimal Getly v1 API client used by the MCP tools.
 *
 * Conventions (mirror of the platform contract):
 * - Base URL https://www.getly.store (override with GETLY_BASE_URL for tests).
 * - Auth: `Authorization: Bearer <key>` — the key comes ONLY from the
 *   GETLY_API_KEY environment variable, never from tool arguments, and is
 *   never logged or echoed back.
 * - Responses: `{ success: true, data }` / `{ success: false, error, errorDetail }`
 *   where errorDetail = { code, message, hint, docsUrl, param? }.
 * - Money: integer cents only (priceCents / discountedPriceCents / valueCents).
 * - Cursor pagination: { items, nextCursor }.
 * - POST creates send an auto-generated Idempotency-Key.
 */

export const DEFAULT_BASE_URL = 'https://www.getly.store';

export function getBaseUrl(): string {
  const raw = process.env.GETLY_BASE_URL;
  return raw && raw.trim() ? raw.trim().replace(/\/+$/, '') : DEFAULT_BASE_URL;
}

/** Read the API key from the environment. Returns null when not configured. */
export function getApiKey(): string | null {
  const key = process.env.GETLY_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

export interface ErrorDetail {
  code: string;
  message: string;
  hint?: string;
  docsUrl?: string;
  param?: string;
}

export interface PublishReason {
  code: string;
  detail: string;
}

/** Error thrown for any non-success Getly API response. Never contains the key. */
export class GetlyApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;
  readonly docsUrl?: string;
  readonly param?: string;
  readonly retryAfterSeconds?: number;
  /** Machine-readable publish blockers (422 not_publishable). */
  readonly reasons?: PublishReason[];

  constructor(
    status: number,
    detail: ErrorDetail,
    opts: { retryAfterSeconds?: number; reasons?: PublishReason[] } = {},
  ) {
    super(detail.message);
    this.name = 'GetlyApiError';
    this.status = status;
    this.code = detail.code;
    this.hint = detail.hint;
    this.docsUrl = detail.docsUrl;
    this.param = detail.param;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.reasons = opts.reasons;
  }
}

export interface ApiEnvelope<T = unknown> {
  success: true;
  data: T;
  /** Extra top-level keys some endpoints add (warnings, total, page, ...). */
  [key: string]: unknown;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Auto-attach a random Idempotency-Key (use on POST creates). */
  idempotent?: boolean;
  /** Override: allow unauthenticated calls (public endpoints). */
  apiKey?: string | null;
  timeoutMs?: number;
}

/**
 * Perform a JSON request against the Getly API and return the full success
 * envelope. Throws GetlyApiError on { success: false } or non-2xx.
 */
export async function apiRequest<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<ApiEnvelope<T>> {
  const url = new URL(path, getBaseUrl() + '/');
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = opts.apiKey === undefined ? getApiKey() : opts.apiKey;
  if (key) headers['Authorization'] = `Bearer ${key}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotent) headers['Idempotency-Key'] = crypto.randomUUID();

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
  } catch (err) {
    throw new GetlyApiError(0, {
      code: 'network_error',
      message: `Could not reach ${url.host}: ${err instanceof Error ? err.message : String(err)}`,
      hint: 'Check the network connection, then retry the same call.',
    });
  }

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (!res.ok || !json || json.success !== true) {
    const detail = (json?.errorDetail ?? {}) as Partial<ErrorDetail>;
    const retryAfterRaw = res.headers.get('retry-after');
    throw new GetlyApiError(
      res.status,
      {
        code: detail.code ?? (res.status === 429 ? 'rate_limited' : 'api_error'),
        message:
          detail.message ??
          (typeof json?.error === 'string' ? json.error : `Request failed with HTTP ${res.status}`),
        hint: detail.hint,
        docsUrl: detail.docsUrl,
        param: detail.param,
      },
      {
        retryAfterSeconds: retryAfterRaw ? Number(retryAfterRaw) || undefined : undefined,
        reasons: Array.isArray(json?.reasons) ? (json.reasons as PublishReason[]) : undefined,
      },
    );
  }

  return json as ApiEnvelope<T>;
}

/**
 * PUT raw bytes to a presigned upload URL. Content-Type and Content-Length
 * are part of the presign signature — they must match exactly what was
 * declared to the presign endpoint.
 */
export async function putPresigned(
  uploadUrl: string,
  bytes: Buffer,
  contentType: string,
  timeoutMs = 300_000,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
    },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new GetlyApiError(res.status, {
      code: 'upload_failed',
      message: `Uploading bytes to storage failed with HTTP ${res.status}`,
      hint: 'Request a fresh presigned URL (they expire after 1 hour) and make sure the file was not modified between presign and upload.',
    });
  }
}
