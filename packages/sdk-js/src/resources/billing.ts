import type { Envelope, HttpClient } from '../http.js';
import type {
  BillingCheckoutInput,
  BillingCheckoutResult,
  BillingPlan,
  BillingPlanCreateInput,
  BillingPlanListParams,
  BillingPlanUpdateInput,
  BillingSubscription,
  BillingSubscriptionListParams,
  BillingSubscriptionListResult,
  MutationOptions,
} from '../types.js';

/** List envelope: data is the array, pagination sits at the top level. */
interface SubscriptionsListEnvelope {
  success: true;
  data: BillingSubscription[];
  pagination: { limit: number; offset: number; hasMore: boolean };
}

/** Plans — recurring prices for your own product (scopes read:billing / write:billing). */
export class BillingPlansResource {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/v1/billing/plans — your plans, newest first. */
  async list(params: BillingPlanListParams = {}): Promise<BillingPlan[]> {
    const res = await this.http.request<Envelope<BillingPlan[]>>('GET', '/api/v1/billing/plans', {
      query: { active: params.active === undefined ? undefined : String(params.active) },
    });
    return res.data;
  }

  /** GET /api/v1/billing/plans/{id} */
  async get(id: string): Promise<BillingPlan> {
    const res = await this.http.request<Envelope<BillingPlan>>(
      'GET',
      `/api/v1/billing/plans/${encodeURIComponent(id)}`,
    );
    return res.data;
  }

  /**
   * POST /api/v1/billing/plans — needs an approved Billing application
   * (403 billing_not_approved until then; apply at /dashboard/billing).
   * 409 plan_exists when the externalId is already used.
   */
  async create(input: BillingPlanCreateInput, opts: MutationOptions = {}): Promise<BillingPlan> {
    const res = await this.http.request<Envelope<BillingPlan>>('POST', '/api/v1/billing/plans', {
      body: input,
      idempotencyKey: opts.idempotencyKey,
    });
    return res.data;
  }

  /** PATCH /api/v1/billing/plans/{id} — price/interval changes affect NEW subscriptions only. */
  async update(id: string, input: BillingPlanUpdateInput): Promise<BillingPlan> {
    const res = await this.http.request<Envelope<BillingPlan>>(
      'PATCH',
      `/api/v1/billing/plans/${encodeURIComponent(id)}`,
      { body: input },
    );
    return res.data;
  }
}

/** Subscriptions to your plans. */
export class BillingSubscriptionsResource {
  constructor(private readonly http: HttpClient) {}

  /** GET /api/v1/billing/subscriptions — newest first, limit/offset pagination. */
  async list(params: BillingSubscriptionListParams = {}): Promise<BillingSubscriptionListResult> {
    const res = await this.http.request<SubscriptionsListEnvelope>('GET', '/api/v1/billing/subscriptions', {
      query: {
        status: params.status,
        customerRef: params.customerRef,
        planId: params.planId,
        limit: params.limit,
        offset: params.offset,
      },
    });
    return { items: res.data, pagination: res.pagination };
  }

  /** Async-iterate every subscription matching the filters. */
  async *iterate(
    params: Omit<BillingSubscriptionListParams, 'offset'> = {},
  ): AsyncGenerator<BillingSubscription> {
    let offset = 0;
    while (true) {
      const page = await this.list({ ...params, offset });
      for (const sub of page.items) yield sub;
      if (!page.pagination.hasMore || page.items.length === 0) return;
      offset += page.items.length;
    }
  }

  /**
   * GET /api/v1/billing/subscriptions/{id} — the status check before granting
   * access. Treat `active` AND `past_due` as entitled until currentPeriodEnd.
   */
  async get(id: string): Promise<BillingSubscription> {
    const res = await this.http.request<Envelope<BillingSubscription>>(
      'GET',
      `/api/v1/billing/subscriptions/${encodeURIComponent(id)}`,
    );
    return res.data;
  }

  /**
   * POST /api/v1/billing/subscriptions/{id}/cancel — stop renewal at the end of
   * the paid period (never an immediate cut-off). Idempotent. 409
   * subscription_not_cancellable when it already ended.
   */
  async cancel(id: string, opts: MutationOptions = {}): Promise<BillingSubscription> {
    const res = await this.http.request<Envelope<BillingSubscription>>(
      'POST',
      `/api/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`,
      { body: {}, idempotencyKey: opts.idempotencyKey },
    );
    return res.data;
  }
}

/**
 * Getly Billing — recurring plans for your OWN product (a SaaS, community or
 * tool on your site). The hosted page offers the live rails: PayPal and
 * USDT/USDC today (one payment buys one period), card when that rail returns.
 */
export class BillingResource {
  readonly plans: BillingPlansResource;
  readonly subscriptions: BillingSubscriptionsResource;

  constructor(private readonly http: HttpClient) {
    this.plans = new BillingPlansResource(http);
    this.subscriptions = new BillingSubscriptionsResource(http);
  }

  /**
   * POST /api/v1/billing/checkout — a signed hosted subscribe page (valid 24h)
   * for ONE customer. customerRef is echoed on every billing.* webhook as
   * externalCustomerRef.
   */
  async createCheckout(input: BillingCheckoutInput, opts: MutationOptions = {}): Promise<BillingCheckoutResult> {
    const res = await this.http.request<Envelope<BillingCheckoutResult>>('POST', '/api/v1/billing/checkout', {
      body: input,
      idempotencyKey: opts.idempotencyKey,
    });
    return res.data;
  }
}
