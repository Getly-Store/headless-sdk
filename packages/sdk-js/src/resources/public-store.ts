import type { Envelope, HttpClient } from '../http.js';
import type { CursorListParams, PublicProduct, PublicStoreProductsResult } from '../types.js';

export class PublicStoreResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/public/stores/{slug}/products — PUBLIC (no API key needed):
   * active products of a non-suspended store. CDN-cached ~5 minutes.
   * Powers storefront widgets.
   */
  async products(
    storeSlug: string,
    params: CursorListParams = {},
  ): Promise<PublicStoreProductsResult> {
    const res = await this.http.request<Envelope<PublicStoreProductsResult>>(
      'GET',
      `/api/v1/public/stores/${encodeURIComponent(storeSlug)}/products`,
      { query: { limit: params.limit, cursor: params.cursor }, auth: false },
    );
    return res.data;
  }

  /** GET .../products/{productSlug} — single public product (with description). */
  async product(storeSlug: string, productSlug: string): Promise<PublicProduct> {
    const res = await this.http.request<Envelope<PublicProduct>>(
      'GET',
      `/api/v1/public/stores/${encodeURIComponent(storeSlug)}/products/${encodeURIComponent(productSlug)}`,
      { auth: false },
    );
    return res.data;
  }

  /** Async-iterate every public product of a store. */
  async *iterateProducts(
    storeSlug: string,
    params: Omit<CursorListParams, 'cursor'> = {},
  ): AsyncGenerator<PublicProduct> {
    let cursor: string | undefined;
    do {
      const page = await this.products(storeSlug, { ...params, cursor });
      for (const item of page.items) yield item;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
}
