/**
 * Minimal Getly v1 API client used by auto-store.
 *
 * NOTE: this mirrors the @getly/sdk surface (products.create / publish /
 * files, posts.create, checkoutLinks.create, store.get). It exists so
 * auto-store is self-contained until @getly/sdk lands in this monorepo —
 * swapping it out is a mechanical import change.
 *
 * Conventions honored (see the Getly Headless SDK spec):
 * - Auth:       `Authorization: Bearer <getly_sk_live_...>` — env only, never logged.
 * - Envelope:   { success: true, data } / { success: false, error, errorDetail }.
 * - Money:      integer cents (priceCents / discountedPriceCents).
 * - Idempotency: `Idempotency-Key` header on every POST.
 */
import type { CategoryNode } from './categories.js';

export const DEFAULT_BASE_URL = 'https://www.getly.store';

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

export class GetlyApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;
  readonly docsUrl?: string;
  readonly param?: string;
  readonly reasons?: PublishReason[];

  constructor(
    status: number,
    detail: Partial<ErrorDetail> & { message: string },
    reasons?: PublishReason[],
  ) {
    super(detail.message);
    this.name = 'GetlyApiError';
    this.status = status;
    this.code = detail.code ?? 'unknown';
    this.hint = detail.hint;
    this.docsUrl = detail.docsUrl;
    this.param = detail.param;
    this.reasons = reasons;
  }
}

export interface V1Product {
  id: string;
  slug: string;
  name: string;
  status: string;
  priceCents: number;
  urls: { product: string; buy: string; embed?: string };
  moderationStatus?: 'pending_review';
  note?: string;
  attachedFiles?: number;
}

export interface V1Post {
  id: string;
  slug: string;
  title: string;
  status: string;
  excerpt: string | null;
}

export interface V1CheckoutLink {
  id: string;
  url: string;
  productId: string;
  status: string;
  priceCents?: number;
  discountedPriceCents?: number;
  couponApplied?: boolean;
  expiresAt: string | null;
}

export interface V1Store {
  id: string;
  name: string;
  slug: string;
}

export interface PresignedImage {
  uploadUrl: string;
  publicUrl: string;
  expiresIn: number;
}

export interface PresignedFile {
  uploadUrl: string;
  fileUrl: string;
  key: string;
  fileName: string;
  fileSize: number;
}

export interface CreateProductBody {
  name: string;
  description: string;
  shortDescription: string;
  priceCents: number;
  categoryId?: string;
  tags?: string[];
  status?: 'draft' | 'active';
  images?: Array<{ url: string; altText?: string }>;
}

export interface CreatePostBody {
  title: string;
  contentMarkdown: string;
  excerpt?: string;
  status?: 'draft' | 'published';
  coverImageUrl?: string;
}

export interface CreateCheckoutLinkBody {
  productId: string;
  couponCode?: string;
  reference?: string;
  metadata?: Record<string, string>;
}

export type PublishResult =
  | { published: true; product: V1Product }
  | { published: false; reasons: PublishReason[] };

export interface GetlyApiOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
}

export class GetlyApi {
  private readonly apiKey: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(opts: GetlyApiOptions) {
    if (!opts.apiKey) throw new Error('GetlyApi: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.userAgent = opts.userAgent ?? 'getly-auto-store/0.1.0';
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'User-Agent': this.userAgent,
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    let json: {
      success?: boolean;
      data?: T;
      error?: string;
      errorDetail?: ErrorDetail;
      reasons?: PublishReason[];
    } | null = null;
    try {
      json = (await res.json()) as typeof json;
    } catch {
      json = null;
    }

    if (!res.ok || !json || json.success !== true) {
      const detail = json?.errorDetail ?? {
        code: res.status === 429 ? 'rate_limited' : 'unknown',
        message: json?.error ?? `Request failed with HTTP ${res.status}`,
      };
      throw new GetlyApiError(res.status, detail, json?.reasons);
    }
    return json.data as T;
  }

  /** Raw byte upload to a presigned URL. No Authorization header — the URL
   * itself is the credential and the target is R2, not the Getly API. */
  async putBytes(uploadUrl: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const res = await this.fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.byteLength),
      },
      body: bytes,
    });
    if (!res.ok) {
      throw new GetlyApiError(res.status, {
        code: 'upload_failed',
        message: `Upload to storage failed with HTTP ${res.status}`,
      });
    }
  }

  readonly categories = {
    list: async (): Promise<CategoryNode[]> =>
      this.request<CategoryNode[]>('GET', '/api/categories'),
  };

  readonly store = {
    get: async (): Promise<V1Store> => this.request<V1Store>('GET', '/api/v1/store'),
  };

  readonly uploads = {
    presignImage: async (body: {
      fileName?: string;
      fileSize: number;
      contentType: string;
    }): Promise<PresignedImage> =>
      this.request<PresignedImage>('POST', '/api/v1/uploads/images/presign', { body }),
  };

  readonly products = {
    create: async (body: CreateProductBody, idempotencyKey?: string): Promise<V1Product> =>
      this.request<V1Product>('POST', '/api/v1/products', { body, idempotencyKey }),

    presignFile: async (
      productId: string,
      body: { fileName: string; fileSize: number; fileType: string },
    ): Promise<PresignedFile> =>
      this.request<PresignedFile>('POST', `/api/v1/products/${productId}/files/presign`, {
        body,
      }),

    attachFile: async (
      productId: string,
      body: { fileUrl: string; fileName: string; fileSize: number; fileType: string },
    ): Promise<unknown> =>
      this.request<unknown>('POST', `/api/v1/products/${productId}/files`, { body }),

    /**
     * One-call publish. 422 not_publishable is a NORMAL outcome (missing
     * file, moderation lock) — returned as { published: false, reasons }
     * so callers can report it honestly instead of catching.
     */
    publish: async (productId: string, idempotencyKey?: string): Promise<PublishResult> => {
      try {
        const product = await this.request<V1Product>(
          'POST',
          `/api/v1/products/${productId}/publish`,
          { idempotencyKey },
        );
        return { published: true, product };
      } catch (err) {
        if (err instanceof GetlyApiError && err.code === 'not_publishable') {
          return { published: false, reasons: err.reasons ?? [] };
        }
        throw err;
      }
    },
  };

  readonly posts = {
    create: async (body: CreatePostBody, idempotencyKey?: string): Promise<V1Post> =>
      this.request<V1Post>('POST', '/api/v1/posts', { body, idempotencyKey }),
  };

  readonly checkoutLinks = {
    create: async (
      body: CreateCheckoutLinkBody,
      idempotencyKey?: string,
    ): Promise<V1CheckoutLink> =>
      this.request<V1CheckoutLink>('POST', '/api/v1/checkout-links', {
        body,
        idempotencyKey,
      }),
  };
}
