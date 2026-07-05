/**
 * @getly/sdk — zero-dependency TypeScript client for the Getly v1 API.
 *
 *   import { Getly } from '@getly/sdk';
 *   const getly = new Getly(); // reads GETLY_API_KEY from the environment
 *   const product = await getly.products.create({ name: 'Icon pack', priceCents: 900 });
 *
 * Conventions (mirroring the platform):
 * - money is ALWAYS integer cents (priceCents, discountedPriceCents, …);
 * - responses unwrap the { success: true, data } envelope;
 * - lists are cursor-paginated { items, nextCursor } with .iterate() helpers;
 * - every create carries an auto-generated Idempotency-Key;
 * - 429s are retried honoring Retry-After (idempotent-safe calls only);
 * - errors throw GetlyError with a stable machine `code` + actionable `hint`.
 */
import { HttpClient, type GetlyOptions } from './http.js';
import type { RateLimitInfo } from './error.js';
import { ProductsResource } from './resources/products.js';
import { PostsResource } from './resources/posts.js';
import { CouponsResource } from './resources/coupons.js';
import { CheckoutLinksResource } from './resources/checkout-links.js';
import { LicensesResource } from './resources/licenses.js';
import { UploadsResource } from './resources/uploads.js';
import { WebhookEndpointsResource } from './resources/webhook-endpoints.js';
import { StoreResource } from './resources/store.js';
import { PayoutsResource } from './resources/payouts.js';
import { OrdersResource } from './resources/orders.js';
import { PublicStoreResource } from './resources/public-store.js';

export class Getly {
  readonly products: ProductsResource;
  readonly posts: PostsResource;
  readonly coupons: CouponsResource;
  readonly checkoutLinks: CheckoutLinksResource;
  readonly licenses: LicensesResource;
  readonly uploads: UploadsResource;
  readonly webhookEndpoints: WebhookEndpointsResource;
  readonly store: StoreResource;
  readonly payouts: PayoutsResource;
  readonly orders: OrdersResource;
  /** Public storefront endpoints — usable WITHOUT an API key. */
  readonly publicStore: PublicStoreResource;

  private readonly http: HttpClient;

  constructor(options: GetlyOptions = {}) {
    this.http = new HttpClient(options);
    this.products = new ProductsResource(this.http);
    this.posts = new PostsResource(this.http);
    this.coupons = new CouponsResource(this.http);
    this.checkoutLinks = new CheckoutLinksResource(this.http);
    this.licenses = new LicensesResource(this.http);
    this.uploads = new UploadsResource(this.http);
    this.webhookEndpoints = new WebhookEndpointsResource(this.http);
    this.store = new StoreResource(this.http);
    this.payouts = new PayoutsResource(this.http);
    this.orders = new OrdersResource(this.http);
    this.publicStore = new PublicStoreResource(this.http);
  }

  /** Rate-limit snapshot from the most recent API response. */
  get lastRateLimit(): RateLimitInfo | null {
    return this.http.lastRateLimit;
  }
}

export { GetlyError, parseRateLimitHeaders } from './error.js';
export type { GetlyErrorCode, RateLimitInfo, PublishBlockedReason } from './error.js';
export { SDK_VERSION, CLIENT_HEADER, DEFAULT_BASE_URL } from './http.js';
export type { GetlyOptions } from './http.js';
export {
  verifyWebhookSignature,
  parseSignatureHeader,
} from './webhooks.js';
export type { VerifyWebhookSignatureInput, GetlyWebhookEvent } from './webhooks.js';
export * from './types.js';
