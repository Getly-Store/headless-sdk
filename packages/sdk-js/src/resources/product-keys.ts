import { GetlyError } from '../error.js';
import type { Envelope, HttpClient } from '../http.js';
import type {
  MutationOptions,
  ProductKey,
  ProductKeyListParams,
  ProductKeyPool,
  ProductKeysAddResult,
} from '../types.js';

/** Platform cap per POST /api/v1/products/{id}/keys request. */
export const KEYS_PER_REQUEST_MAX = 5000;

/**
 * Seller key pool — sell YOUR OWN license keys. With keyPoolEnabled on the
 * product, each buyer gets the next unsold key in the order you added them;
 * sale.completed carries it as items[].licenseKey.
 */
export class ProductKeysResource {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/v1/products/{id}/keys — counters + one page of masked keys (scope read:products). */
  async list(productId: string, params: ProductKeyListParams = {}): Promise<ProductKeyPool> {
    const res = await this.http.request<Envelope<ProductKeyPool>>(
      'GET',
      `/api/v1/products/${encodeURIComponent(productId)}/keys`,
      { query: { limit: params.limit, offset: params.offset } },
    );
    return res.data;
  }

  /** Async-iterate every key (masked) in sale order. */
  async *iterate(productId: string, params: Omit<ProductKeyListParams, 'offset'> = {}): AsyncGenerator<ProductKey> {
    let offset = 0;
    while (true) {
      const page = await this.list(productId, { ...params, offset });
      for (const k of page.keys) yield k;
      offset += page.keys.length;
      if (page.keys.length === 0 || offset >= page.total) return;
    }
  }

  /**
   * POST /api/v1/products/{id}/keys — add up to 5000 keys (each ≤500 chars).
   * Trimmed, blanks dropped, duplicates counted not added; sold in the order
   * sent; waiting buyers are filled immediately.
   */
  async add(productId: string, keys: string[], opts: MutationOptions = {}): Promise<ProductKeysAddResult> {
    if (keys.length > KEYS_PER_REQUEST_MAX) {
      throw new GetlyError(
        `products.keys.add: ${keys.length} keys in one call; the API accepts at most ${KEYS_PER_REQUEST_MAX} per request — split the list (use addMany).`,
        { status: 0, code: 'validation_failed', param: 'keys' },
      );
    }
    const res = await this.http.request<Envelope<ProductKeysAddResult>>(
      'POST',
      `/api/v1/products/${encodeURIComponent(productId)}/keys`,
      { body: { keys }, idempotencyKey: opts.idempotencyKey },
    );
    return res.data;
  }

  /** add() in chunks of 5000, summing the counters. */
  async addMany(productId: string, keys: string[], opts: { idempotencyKeyPrefix?: string } = {}): Promise<ProductKeysAddResult> {
    const total: ProductKeysAddResult = { added: 0, duplicates: 0, duplicatesInInput: 0, tooLong: 0, blank: 0, filled: 0 };
    for (let i = 0; i < keys.length; i += KEYS_PER_REQUEST_MAX) {
      const chunk = keys.slice(i, i + KEYS_PER_REQUEST_MAX);
      const r = await this.add(productId, chunk, {
        idempotencyKey: opts.idempotencyKeyPrefix ? `${opts.idempotencyKeyPrefix}:${i / KEYS_PER_REQUEST_MAX}` : undefined,
      });
      for (const k of Object.keys(total) as Array<keyof ProductKeysAddResult>) total[k] += r[k];
    }
    return total;
  }

  /**
   * DELETE /api/v1/products/{id}/keys/{keyId} — remove an UNSOLD key. An issued
   * key is a sale record and stays (GetlyError key_not_available, 409).
   */
  async remove(productId: string, keyId: string): Promise<{ id: string; removed: true }> {
    const res = await this.http.request<Envelope<{ id: string; removed: true }>>(
      'DELETE',
      `/api/v1/products/${encodeURIComponent(productId)}/keys/${encodeURIComponent(keyId)}`,
    );
    return res.data;
  }
}
