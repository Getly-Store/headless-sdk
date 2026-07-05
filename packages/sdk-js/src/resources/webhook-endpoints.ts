import type { Envelope, HttpClient } from '../http.js';
import type {
  MutationOptions,
  Page,
  WebhookEndpoint,
  WebhookEndpointCreateInput,
  WebhookEndpointUpdateInput,
  WebhookEndpointWithSecret,
} from '../types.js';

export class WebhookEndpointsResource {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/v1/webhook-endpoints (secrets are never returned here). */
  async list(): Promise<Page<WebhookEndpoint>> {
    const res = await this.http.request<Envelope<Page<WebhookEndpoint>>>(
      'GET',
      '/api/v1/webhook-endpoints',
    );
    return res.data;
  }

  /**
   * POST /api/v1/webhook-endpoints — register an endpoint. The response
   * includes `secret` EXACTLY ONCE — persist it immediately (env var), you
   * cannot retrieve it again.
   */
  async create(
    input: WebhookEndpointCreateInput,
    opts: MutationOptions = {},
  ): Promise<WebhookEndpointWithSecret> {
    const res = await this.http.request<Envelope<WebhookEndpointWithSecret>>(
      'POST',
      '/api/v1/webhook-endpoints',
      { body: input, idempotencyKey: opts.idempotencyKey },
    );
    return res.data;
  }

  /** PATCH /api/v1/webhook-endpoints/{id} */
  async update(id: string, input: WebhookEndpointUpdateInput): Promise<WebhookEndpoint> {
    const res = await this.http.request<Envelope<WebhookEndpoint>>(
      'PATCH',
      `/api/v1/webhook-endpoints/${encodeURIComponent(id)}`,
      { body: input },
    );
    return res.data;
  }

  /** DELETE /api/v1/webhook-endpoints/{id} */
  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const res = await this.http.request<Envelope<{ id: string; deleted: true }>>(
      'DELETE',
      `/api/v1/webhook-endpoints/${encodeURIComponent(id)}`,
    );
    return res.data;
  }
}
