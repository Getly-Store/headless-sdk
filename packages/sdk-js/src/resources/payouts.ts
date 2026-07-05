import type { Envelope, HttpClient } from '../http.js';
import type { PayoutsSnapshot } from '../types.js';

export class PayoutsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/payouts — balances (all integer cents), current period,
   * lifetime totals and the next scheduled payouts (1st & 15th, both rails).
   */
  async get(): Promise<PayoutsSnapshot> {
    const res = await this.http.request<Envelope<PayoutsSnapshot>>('GET', '/api/v1/payouts');
    return res.data;
  }
}
