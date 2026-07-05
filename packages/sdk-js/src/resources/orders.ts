import type { HttpClient } from '../http.js';
import type { Order, OrderItem, OrderListParams, OrderListResult } from '../types.js';

/** Legacy list envelope: data is the array, page info sits at the top level. */
interface OrdersListEnvelope {
  success: true;
  data: OrderItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export class OrdersResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/orders — your store's order items (page/limit pagination —
   * this endpoint predates cursor pagination). Buyer emails are never
   * included (privacy).
   */
  async list(params: OrderListParams = {}): Promise<OrderListResult> {
    const res = await this.http.request<OrdersListEnvelope>('GET', '/api/v1/orders', {
      query: { page: params.page, limit: params.limit },
    });
    return {
      items: res.data,
      total: res.total,
      page: res.page,
      limit: res.limit,
      hasMore: res.hasMore,
    };
  }

  /** Async-iterate every order item across all pages. */
  async *iterate(params: Omit<OrderListParams, 'page'> = {}): AsyncGenerator<OrderItem> {
    let page = 1;
    while (true) {
      const res = await this.list({ ...params, page });
      for (const item of res.items) yield item;
      if (!res.hasMore) return;
      page += 1;
    }
  }

  /** GET /api/v1/orders/{id} — only items belonging to your store. */
  async get(id: string): Promise<Order> {
    const res = await this.http.request<{ success: true; data: Order }>(
      'GET',
      `/api/v1/orders/${encodeURIComponent(id)}`,
    );
    return res.data;
  }
}
