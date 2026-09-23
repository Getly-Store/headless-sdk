import type { Envelope, HttpClient } from '../http.js';
import type {
  PublicCheckoutCheckResult,
  PublicCheckoutInput,
  PublicCheckoutResult,
  PublicCheckoutStatus,
} from '../types.js';

/**
 * The Pay Widget's public checkout — NO API key. You normally embed pay.js
 * instead of calling this; it is here for custom buttons and server-side
 * checks. Read `paymentMethods` from publicStore.product() first: card
 * checkout is paused today, PayPal and crypto need the buyer's email.
 */
export class PublicCheckoutResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * POST /api/v1/public/checkout — start a checkout on one rail and get the
   * hosted payment url. A rail that is not live throws GetlyError
   * `payment_method_unavailable` with `details.paymentMethods`.
   */
  async create(input: PublicCheckoutInput): Promise<PublicCheckoutResult> {
    const res = await this.http.request<Envelope<PublicCheckoutResult>>('POST', '/api/v1/public/checkout', {
      body: input,
      auth: false,
    });
    return res.data;
  }

  /**
   * POST /api/v1/public/checkout with `check: true` — runs every configuration
   * check (store approved, domain allowed, product live, price) and stops
   * before any payment. No counters are spent.
   */
  async check(input: Pick<PublicCheckoutInput, 'storeSlug' | 'productSlug' | 'linkId'>): Promise<PublicCheckoutCheckResult> {
    const res = await this.http.request<Envelope<PublicCheckoutCheckResult>>('POST', '/api/v1/public/checkout', {
      body: { ...input, check: true },
      auth: false,
    });
    return res.data;
  }

  /**
   * GET /api/v1/public/checkout/{linkId}/status — open | completed | expired.
   * Advisory only: never unlock content on it; verify sales via sale.completed.
   */
  async status(linkId: string): Promise<PublicCheckoutStatus> {
    const res = await this.http.request<Envelope<PublicCheckoutStatus>>(
      'GET',
      `/api/v1/public/checkout/${encodeURIComponent(linkId)}/status`,
      { auth: false },
    );
    return res.data;
  }
}
