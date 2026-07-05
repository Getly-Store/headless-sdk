import type { Envelope, HttpClient } from '../http.js';
import type {
  LicenseActivateResult,
  LicenseDeactivateResult,
  LicenseKey,
  LicenseListParams,
  LicenseValidateResult,
  Page,
} from '../types.js';
import { paginate } from './paginate.js';

export class LicensesResource {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/v1/licenses — issued keys for your store (scope read:licenses). */
  async list(params: LicenseListParams = {}): Promise<Page<LicenseKey>> {
    const res = await this.http.request<Envelope<Page<LicenseKey>>>('GET', '/api/v1/licenses', {
      query: { limit: params.limit, cursor: params.cursor, productId: params.productId },
    });
    return res.data;
  }

  iterate(params: Omit<LicenseListParams, 'cursor'> = {}): AsyncGenerator<LicenseKey> {
    return paginate((cursor) => this.list({ ...params, cursor }));
  }

  /**
   * POST /api/v1/licenses/validate — PUBLIC (no API key needed): call this
   * from your shipped software to check a buyer's license.
   * Invalid keys return { valid: false } — the endpoint is not an oracle.
   */
  async validate(input: { key: string; productId?: string }): Promise<LicenseValidateResult> {
    const res = await this.http.request<Envelope<LicenseValidateResult>>(
      'POST',
      '/api/v1/licenses/validate',
      { body: input, auth: false },
    );
    return res.data;
  }

  /**
   * POST /api/v1/licenses/activate — PUBLIC: claim an activation seat for a
   * device/install. Idempotent per fingerprint. Throws GetlyError with code
   * 'activation_limit_reached' when all seats are used.
   */
  async activate(input: {
    key: string;
    /** Stable device/install identifier (1-200 chars). */
    fingerprint: string;
    label?: string;
  }): Promise<LicenseActivateResult> {
    const res = await this.http.request<Envelope<LicenseActivateResult>>(
      'POST',
      '/api/v1/licenses/activate',
      { body: input, auth: false },
    );
    return res.data;
  }

  /**
   * POST /api/v1/licenses/deactivate — PUBLIC: release an activation seat.
   * Idempotent: deactivating a non-active fingerprint succeeds as a no-op.
   */
  async deactivate(input: { key: string; fingerprint: string }): Promise<LicenseDeactivateResult> {
    const res = await this.http.request<Envelope<LicenseDeactivateResult>>(
      'POST',
      '/api/v1/licenses/deactivate',
      { body: input, auth: false },
    );
    return res.data;
  }
}
