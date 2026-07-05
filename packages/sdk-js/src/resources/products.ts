import { GetlyError } from '../error.js';
import { byteLength, toBodyInit, type Envelope, type HttpClient } from '../http.js';
import type {
  AttachFileInput,
  CreateManyItemResult,
  CreateManyOptions,
  FilePresign,
  MutationOptions,
  Page,
  PresignFileInput,
  Product,
  ProductCreateInput,
  ProductFile,
  ProductListParams,
  ProductUpdateInput,
  ProductWithModeration,
  UploadFileInput,
} from '../types.js';
import { paginate } from './paginate.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB — platform hard limit

export class ProductsResource {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/v1/products — cursor-paginated list of your store's products. */
  async list(params: ProductListParams = {}): Promise<Page<Product>> {
    const res = await this.http.request<Envelope<Page<Product>>>('GET', '/api/v1/products', {
      query: {
        limit: params.limit,
        cursor: params.cursor,
        category: params.category,
        search: params.search,
        status: params.status,
      },
    });
    return res.data;
  }

  /** Async-iterate every product across all pages. */
  iterate(params: Omit<ProductListParams, 'cursor'> = {}): AsyncGenerator<Product> {
    return paginate((cursor) => this.list({ ...params, cursor }));
  }

  /** GET /api/v1/products/{id} */
  async get(id: string): Promise<Product> {
    const res = await this.http.request<Envelope<Product>>(
      'GET',
      `/api/v1/products/${encodeURIComponent(id)}`,
    );
    return res.data;
  }

  /**
   * POST /api/v1/products — create a product (draft by default).
   * An Idempotency-Key is generated automatically unless you pass one.
   */
  async create(input: ProductCreateInput, opts: MutationOptions = {}): Promise<ProductWithModeration> {
    const res = await this.http.request<Envelope<ProductWithModeration>>('POST', '/api/v1/products', {
      body: input,
      idempotencyKey: opts.idempotencyKey,
    });
    return res.data;
  }

  /** PATCH /api/v1/products/{id} */
  async update(id: string, input: ProductUpdateInput): Promise<Product> {
    const res = await this.http.request<Envelope<Product>>(
      'PATCH',
      `/api/v1/products/${encodeURIComponent(id)}`,
      { body: input },
    );
    return res.data;
  }

  /** DELETE /api/v1/products/{id} — soft-delete (status → archived). */
  async archive(id: string): Promise<{ id: string; status: 'archived' }> {
    const res = await this.http.request<Envelope<{ id: string; status: 'archived' }>>(
      'DELETE',
      `/api/v1/products/${encodeURIComponent(id)}`,
    );
    return res.data;
  }

  /**
   * POST /api/v1/products/{id}/publish — one-call publish.
   * On 422 the thrown GetlyError has code 'not_publishable' and a
   * machine-readable `reasons` array (missing_file, moderation_locked, …).
   */
  async publish(id: string, opts: MutationOptions = {}): Promise<ProductWithModeration> {
    const res = await this.http.request<Envelope<ProductWithModeration>>(
      'POST',
      `/api/v1/products/${encodeURIComponent(id)}/publish`,
      { body: {}, idempotencyKey: opts.idempotencyKey },
    );
    return res.data;
  }

  /** POST /api/v1/products/{id}/files/presign — presigned PUT for a file. */
  async presignFile(productId: string, input: PresignFileInput, opts: MutationOptions = {}): Promise<FilePresign> {
    const res = await this.http.request<Envelope<FilePresign>>(
      'POST',
      `/api/v1/products/${encodeURIComponent(productId)}/files/presign`,
      { body: input, idempotencyKey: opts.idempotencyKey },
    );
    return res.data;
  }

  /** POST /api/v1/products/{id}/files (JSON) — attach a presign-uploaded file. */
  async attachFile(productId: string, input: AttachFileInput, opts: MutationOptions = {}): Promise<ProductFile> {
    const res = await this.http.request<Envelope<ProductFile>>(
      'POST',
      `/api/v1/products/${encodeURIComponent(productId)}/files`,
      { body: input, idempotencyKey: opts.idempotencyKey },
    );
    return res.data;
  }

  /**
   * One-call upload: presign → PUT the bytes → attach. Returns the attached
   * file. Max 2GB (the platform's hard limit — multipart upload for very
   * large files is on the roadmap; a single presigned PUT covers 2GB today).
   */
  async uploadFile(productId: string, input: UploadFileInput, opts: MutationOptions = {}): Promise<ProductFile> {
    const size = byteLength(input.data);
    if (size <= 0) {
      throw new GetlyError('uploadFile: data is empty', { status: 0, code: 'validation_failed', param: 'data' });
    }
    if (size > MAX_FILE_BYTES) {
      throw new GetlyError(
        `uploadFile: file is ${size} bytes but the v1 API accepts at most 2GB per file. Split the archive into parts under 2GB and attach each as its own file.`,
        { status: 0, code: 'validation_failed', param: 'data' },
      );
    }

    const fileType = input.fileType || 'application/octet-stream';
    const presign = await this.presignFile(productId, {
      fileName: input.fileName,
      fileSize: size,
      fileType,
    });

    // Content-Length is part of the presign signature — send exactly `size`.
    const putRes = await this.http.rawFetch(presign.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': fileType, 'Content-Length': String(size) },
      body: toBodyInit(input.data),
    });
    if (!putRes.ok) {
      throw new GetlyError(
        `uploadFile: storage upload failed (HTTP ${putRes.status}). The presigned URL may have expired (1h) or the byte count changed — retry uploadFile().`,
        { status: putRes.status, code: 'internal_error' },
      );
    }

    return this.attachFile(
      productId,
      {
        fileUrl: presign.fileUrl,
        fileName: input.fileName,
        fileSize: size,
        fileType,
        versionNotes: input.versionNotes,
      },
      opts,
    );
  }

  /**
   * Throttled batch create respecting the 30/min mutation sublimit and the
   * 20/day cap. Never throws for individual items — returns per-item
   * { ok, product | error }. Pass `idempotencyKeyPrefix` to make re-runs
   * replay already-created items instead of duplicating them.
   * On quota_exceeded the remaining items are marked failed without more
   * API calls (retry after the UTC midnight reset with the same prefix).
   */
  async createMany(
    inputs: ProductCreateInput[],
    opts: CreateManyOptions = {},
  ): Promise<CreateManyItemResult[]> {
    const concurrency = Math.min(Math.max(1, opts.concurrency ?? 2), 8);
    const results: CreateManyItemResult[] = new Array(inputs.length);
    let nextIndex = 0;
    let completed = 0;
    let quotaError: GetlyError | null = null;

    const worker = async (): Promise<void> => {
      while (true) {
        const i = nextIndex++;
        if (i >= inputs.length) return;

        if (quotaError) {
          results[i] = { index: i, ok: false, error: quotaError };
        } else {
          const idempotencyKey = opts.idempotencyKeyPrefix
            ? `${opts.idempotencyKeyPrefix}:${i}`
            : undefined;
          try {
            const product = await this.create(inputs[i], { idempotencyKey });
            results[i] = { index: i, ok: true, product };
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            results[i] = { index: i, ok: false, error };
            if (err instanceof GetlyError && err.code === 'quota_exceeded') {
              quotaError = err;
            }
          }
        }
        completed += 1;
        opts.onProgress?.(results[i], completed, inputs.length);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, Math.max(inputs.length, 1)) }, () => worker()),
    );
    return results;
  }
}
