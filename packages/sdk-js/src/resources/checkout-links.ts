import type { Envelope, HttpClient } from '../http.js';
import type {
  CheckoutLink,
  CheckoutLinkCreateInput,
  CheckoutLinkListParams,
  CheckoutLinkPollResult,
  MutationOptions,
  Page,
} from '../types.js';
import { paginate } from './paginate.js';

export class CheckoutLinksResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * POST /api/v1/checkout-links — mint an instant pay link for one product
   * (scope checkout:create). Naturally idempotent per
   * (productId, couponCode, reference): re-creating an open link returns the
   * existing one. Send the buyer to `data.url`.
   */
  async create(input: CheckoutLinkCreateInput, opts: MutationOptions = {}): Promise<CheckoutLink> {
    const res = await this.http.request<Envelope<CheckoutLink>>('POST', '/api/v1/checkout-links', {
      body: input,
      idempotencyKey: opts.idempotencyKey,
    });
    return res.data;
  }

  /** GET /api/v1/checkout-links — cursor-paginated list. */
  async list(params: CheckoutLinkListParams = {}): Promise<Page<CheckoutLink>> {
    const res = await this.http.request<Envelope<Page<CheckoutLink>>>(
      'GET',
      '/api/v1/checkout-links',
      { query: { limit: params.limit, cursor: params.cursor, status: params.status } },
    );
    return res.data;
  }

  iterate(params: Omit<CheckoutLinkListParams, 'cursor'> = {}): AsyncGenerator<CheckoutLink> {
    return paginate((cursor) => this.list({ ...params, cursor }));
  }

  /**
   * GET /api/v1/checkout-links/{id} — status polling (open | completed |
   * expired, + orderId when completed) for bots without a public webhook URL.
   */
  async get(id: string): Promise<CheckoutLinkPollResult> {
    const res = await this.http.request<Envelope<CheckoutLinkPollResult>>(
      'GET',
      `/api/v1/checkout-links/${encodeURIComponent(id)}`,
    );
    return res.data;
  }
}
