/**
 * HTTP core for the Getly SDK: auth, envelope parsing, GetlyError, automatic
 * Idempotency-Key on creates, 429 retries honoring Retry-After, and a
 * proactive throttle driven by X-RateLimit-Remaining.
 *
 * Zero runtime dependencies — global fetch (Node >= 18 / edge).
 */
import { GetlyError, parseRateLimitHeaders, type RateLimitInfo } from './error.js';

export const SDK_VERSION = '0.1.0';
export const CLIENT_HEADER = `@getly/sdk/${SDK_VERSION}`;
export const DEFAULT_BASE_URL = 'https://www.getly.store';

export interface GetlyOptions {
  /**
   * API key (getly_sk_live_…). Defaults to process.env.GETLY_API_KEY.
   * NEVER pass keys through CLI args or log them.
   */
  apiKey?: string;
  /** API origin. Default: https://www.getly.store */
  baseUrl?: string;
  /** Max automatic retries on 429 (idempotent-safe calls only). Default 2. */
  maxRetries?: number;
  /**
   * Proactive throttle: when a response reports X-RateLimit-Remaining <= 1,
   * wait for the window to reset before the next call. Default true.
   */
  throttle?: boolean;
  /** Custom fetch (testing / instrumentation). Default: globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Explicit Idempotency-Key; auto-generated for authed POSTs when omitted. */
  idempotencyKey?: string;
  /** Set false for public endpoints (license validate, public storefront). */
  auth?: boolean;
  headers?: Record<string, string>;
}

/** Success envelope: { success: true, data } (+ occasional top-level extras). */
export interface Envelope<T> {
  success: true;
  data: T;
  warnings?: string[];
  [key: string]: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIdempotencyKey(): string {
  // Node >= 18 and every edge runtime expose webcrypto's randomUUID.
  return globalThis.crypto.randomUUID();
}

export class HttpClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly throttleEnabled: boolean;
  private readonly fetchImpl: typeof globalThis.fetch;

  /** Rate-limit snapshot from the most recent response (any endpoint). */
  lastRateLimit: RateLimitInfo | null = null;
  /** Epoch ms until which the proactive throttle should hold new requests. */
  private throttleUntil = 0;

  constructor(options: GetlyOptions = {}) {
    this.apiKey =
      options.apiKey ??
      (typeof process !== 'undefined' ? process.env?.GETLY_API_KEY : undefined);
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.maxRetries = options.maxRetries ?? 2;
    this.throttleEnabled = options.throttle ?? true;
    // Bind to preserve `this` for the global fetch in Node.
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Raw fetch passthrough (presigned PUT uploads). */
  rawFetch(input: string | URL, init?: RequestInit): Promise<Response> {
    return this.fetchImpl(input, init);
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private recordRateLimit(headers: Headers): void {
    const info = parseRateLimitHeaders(headers);
    if (info.limit === null && info.remaining === null && info.resetSeconds === null) return;
    this.lastRateLimit = info;
    if (
      this.throttleEnabled &&
      info.remaining !== null &&
      info.remaining <= 1 &&
      info.resetSeconds !== null &&
      info.resetSeconds > 0
    ) {
      // Cap the proactive wait at 60s so a weird header can't stall forever.
      this.throttleUntil = Date.now() + Math.min(info.resetSeconds, 60) * 1000;
    }
  }

  private async maybeThrottle(): Promise<void> {
    if (!this.throttleEnabled) return;
    const wait = this.throttleUntil - Date.now();
    if (wait > 0) {
      await sleep(wait);
      this.throttleUntil = 0;
    }
  }

  /**
   * Perform a v1 request and return the parsed JSON body (the full envelope).
   * Throws GetlyError on any non-2xx response.
   */
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const useAuth = options.auth !== false;
    if (useAuth && !this.apiKey) {
      throw new GetlyError(
        'Missing API key. Set the GETLY_API_KEY environment variable (or pass apiKey to new Getly()). Create a key at https://www.getly.store/dashboard/developer/keys — never hardcode it.',
        { status: 0, code: 'unauthorized' },
      );
    }

    // Auto Idempotency-Key on every authenticated POST (creates) — makes the
    // request replay-safe on the server AND makes our own 429 retries safe.
    let idempotencyKey = options.idempotencyKey;
    if (!idempotencyKey && method === 'POST' && useAuth) {
      idempotencyKey = randomIdempotencyKey();
    }

    const headers: Record<string, string> = {
      'X-Getly-Client': CLIENT_HEADER,
      ...(options.headers ?? {}),
    };
    if (useAuth) headers['Authorization'] = `Bearer ${this.apiKey}`;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    let bodyInit: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyInit = JSON.stringify(options.body);
    }

    const url = this.buildUrl(path, options.query);
    // Retries are only safe for GETs and for requests carrying an
    // Idempotency-Key (which is every authed POST by default).
    const retryable = method === 'GET' || !!idempotencyKey;

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.maybeThrottle();

      const res = await this.fetchImpl(url, { method, headers, body: bodyInit });
      this.recordRateLimit(res.headers);

      if (res.status === 429 && retryable && attempt < this.maxRetries) {
        attempt += 1;
        const info = parseRateLimitHeaders(res.headers);
        const waitSec = info.retryAfterSeconds ?? info.resetSeconds ?? 1;
        await sleep(Math.min(Math.max(waitSec, 0), 60) * 1000);
        continue;
      }

      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        // Non-JSON body (proxy error page etc.) — handled below.
      }

      if (!res.ok) {
        throw GetlyError.fromResponse(res.status, parsed, res.headers);
      }
      if (parsed === null) {
        throw new GetlyError(`Getly API returned a non-JSON response (HTTP ${res.status})`, {
          status: res.status,
          code: 'internal_error',
          rateLimit: parseRateLimitHeaders(res.headers),
        });
      }
      return parsed as T;
    }
  }
}

/** Byte length of any uploadable body. */
export function byteLength(data: Uint8Array | ArrayBuffer | Blob): number {
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.byteLength;
}

/** Normalize an uploadable body into something fetch accepts as BodyInit. */
export function toBodyInit(data: Uint8Array | ArrayBuffer | Blob): BodyInit {
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  // Re-wrap so a Node Buffer is sent as a plain Uint8Array view. The cast is
  // safe: fetch only reads the bytes (TS 5.9's BodyInit excludes views over
  // SharedArrayBuffer, which uploads never use in practice).
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength) as Uint8Array<ArrayBuffer>;
}
