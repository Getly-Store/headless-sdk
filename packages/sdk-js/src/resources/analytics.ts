import type { Envelope, HttpClient } from '../http.js';
import type { SalesAnalytics } from '../types.js';

export class AnalyticsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/analytics (scope read:analytics) — sales summary. Revenue
   * figures are your seller share in integer cents; salesByMonth covers the
   * last 6 months.
   */
  async get(): Promise<SalesAnalytics> {
    const res = await this.http.request<Envelope<SalesAnalytics>>('GET', '/api/v1/analytics');
    return res.data;
  }
}
