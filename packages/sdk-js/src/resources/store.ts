import type { Envelope, HttpClient } from '../http.js';
import type {
  MutationOptions,
  PayoutOnboardingResult,
  Store,
  StoreCreateInput,
  StoreUpdateInput,
} from '../types.js';

export class StoreResource {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/v1/store — the store bound to your API key. */
  async get(): Promise<Store> {
    const res = await this.http.request<Envelope<Store>>('GET', '/api/v1/store');
    return res.data;
  }

  /**
   * POST /api/v1/store — create a store for the key's user if none exists
   * (one store per user; 409 when you already have one).
   */
  async create(input: StoreCreateInput, opts: MutationOptions = {}): Promise<Store> {
    const res = await this.http.request<Envelope<Store>>('POST', '/api/v1/store', {
      body: input,
      idempotencyKey: opts.idempotencyKey,
    });
    return res.data;
  }

  /** PATCH /api/v1/store */
  async update(input: StoreUpdateInput): Promise<Store> {
    const res = await this.http.request<Envelope<Store>>('PATCH', '/api/v1/store', {
      body: input,
    });
    return res.data;
  }

  /**
   * POST /api/v1/store/payout-onboarding — RETIRED.
   *
   * @deprecated Since 2026-09-23 the endpoint no longer creates Stripe Connect
   * accounts: it always rejects with a GetlyError whose `code` is
   * `payout_route_retired` (HTTP 410). Seller payouts are stablecoin-only since
   * 2026-09-15 — USDT/USDC on BNB Smart Chain (min $5) or USDT on Tron
   * (min $15), on the 1st and 15th — and the seller saves the wallet at
   * https://www.getly.store/dashboard/settings?tab=payments (not possible
   * through the API). Kept only so existing callers get that clear error.
   */
  async payoutOnboarding(opts: MutationOptions = {}): Promise<PayoutOnboardingResult> {
    const res = await this.http.request<Envelope<PayoutOnboardingResult>>(
      'POST',
      '/api/v1/store/payout-onboarding',
      { body: {}, idempotencyKey: opts.idempotencyKey },
    );
    return res.data;
  }
}
