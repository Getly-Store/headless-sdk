import type { Envelope, HttpClient } from '../http.js';
import type {
  Coupon,
  CouponCreateInput,
  CouponListParams,
  CouponUpdateInput,
  MutationOptions,
  Page,
} from '../types.js';
import { paginate } from './paginate.js';

export class CouponsResource {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/v1/coupons — your store's coupons (cursor pagination). */
  async list(params: CouponListParams = {}): Promise<Page<Coupon>> {
    const res = await this.http.request<Envelope<Page<Coupon>>>('GET', '/api/v1/coupons', {
      query: {
        limit: params.limit,
        cursor: params.cursor,
        active: params.active === undefined ? undefined : String(params.active),
      },
    });
    return res.data;
  }

  iterate(params: Omit<CouponListParams, 'cursor'> = {}): AsyncGenerator<Coupon> {
    return paginate((cursor) => this.list({ ...params, cursor }));
  }

  /**
   * POST /api/v1/coupons — percentage discounts >= 90% require
   * acknowledgeHighDiscount: true (error high_discount_ack_required).
   * Daily cap: 30/day per key.
   */
  async create(input: CouponCreateInput, opts: MutationOptions = {}): Promise<Coupon> {
    const res = await this.http.request<Envelope<Coupon>>('POST', '/api/v1/coupons', {
      body: input,
      idempotencyKey: opts.idempotencyKey,
    });
    return res.data;
  }

  /**
   * PATCH /api/v1/coupons/{id} — only isActive / expiresAt / maxUses are
   * mutable. code/type/value are immutable: create a new coupon instead.
   */
  async update(id: string, input: CouponUpdateInput): Promise<Coupon> {
    const res = await this.http.request<Envelope<Coupon>>(
      'PATCH',
      `/api/v1/coupons/${encodeURIComponent(id)}`,
      { body: input },
    );
    return res.data;
  }

  /** DELETE /api/v1/coupons/{id} — only never-used coupons can be deleted. */
  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const res = await this.http.request<Envelope<{ id: string; deleted: true }>>(
      'DELETE',
      `/api/v1/coupons/${encodeURIComponent(id)}`,
    );
    return res.data;
  }
}
