/**
 * Request/response types for the Getly v1 API.
 *
 * Derived from the platform serializers (api-v1-serializers.ts,
 * posts/serialize.ts, checkout-links + licenses routes, public store
 * products serialize.ts). Money is ALWAYS integer minor units and named
 * with a `Cents` suffix (priceCents, discountedPriceCents, amountCents…);
 * legacy dollar fields exist on the wire but the SDK types surface cents.
 * Timestamps travel as ISO-8601 strings over JSON.
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** Cursor-paginated list page: cursor = base64("createdAtISO|id"). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CursorListParams {
  /** Max items per page (1-100, default 20). */
  limit?: number;
  /** Opaque cursor from the previous page's `nextCursor`. */
  cursor?: string;
}

/** Per-call options for create/mutation requests. */
export interface MutationOptions {
  /**
   * Explicit Idempotency-Key. When omitted the SDK generates one
   * automatically (crypto.randomUUID()) for every create, which also makes
   * 429 retries safe.
   */
  idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export type ProductStatus = 'draft' | 'active' | 'pending_review' | 'archived' | 'rejected';

/**
 * What the buyer may do with the file — shown next to the buy button, in the
 * product FAQ and in the page's structured data. `null` = not stated.
 */
export type ProductLicenseType = 'personal' | 'commercial' | 'extended' | 'cc0' | 'custom';

export interface ProductImage {
  id?: string;
  url: string;
  altText: string | null;
  sortOrder?: number;
}

export interface ProductFile {
  id: string;
  fileName: string;
  fileUrl?: string;
  /** Bytes. */
  fileSize: number;
  fileType: string;
  version?: number | string | null;
  versionNotes?: string | null;
  isLatest: boolean;
  createdAt: string;
}

export interface ProductUrls {
  /** Public product page. */
  product: string;
  /** Purchase entry point (guest-checkout capable). */
  buy: string;
  /** Embeddable product widget. */
  embed: string;
}

export interface Product {
  id: string;
  storeId: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  /** Integer minor units (the canonical money field). */
  priceCents: number;
  compareAtPriceCents: number | null;
  /** Legacy field — same integer cents as priceCents. Prefer priceCents. */
  price: number;
  status: ProductStatus | string;
  categoryId: string | null;
  tags: string[] | null;
  licenseKeysEnabled: boolean;
  licenseActivationLimit: number;
  /** What the buyer may do with the file; null = not stated. Always present. */
  licenseType: ProductLicenseType | null;
  /** Each buyer gets the next unsold key from YOUR pool (products.keys) instead of a Getly-generated key. */
  keyPoolEnabled: boolean;
  /** "Running low" email when available pool keys drop to this many (1-1000, default 5). */
  keyPoolLowThreshold: number;
  /** Timed access: 'lifetime' (default) or 'timed' — sold as access for a period on a one-time payment. */
  accessMode: 'lifetime' | 'timed';
  /** Present when relations were loaded (GET single). The periods on offer, shortest first. */
  accessTerms?: AccessTerm[];
  createdVia?: string | null;
  urls: ProductUrls;
  createdAt: string;
  updatedAt: string;
  /** Present when relations were loaded (GET single / list). */
  images?: ProductImage[];
  files?: Omit<ProductFile, 'fileUrl'>[];
  category?: { id: string; name: string; slug: string } | null;
  /** Extra serialized fields pass through untouched. */
  [key: string]: unknown;
}

/** Product returned by create/publish — may carry moderation info. */
export interface ProductWithModeration extends Product {
  /** Set when the first-sale gate / AI classifier queued the product. */
  moderationStatus?: 'pending_review';
  /** Human-readable moderation note. */
  note?: string;
  /** Number of files attached inline at creation. */
  attachedFiles?: number;
}

export interface ProductListParams extends CursorListParams {
  /** Category id filter. */
  category?: string;
  /** Name substring search. */
  search?: string;
  /** Status filter (default 'active'). */
  status?: 'active' | 'draft' | 'pending_review' | 'archived';
}

/** One period a timed-access product is sold on. Money is integer cents. */
export interface AccessTerm {
  id: string;
  durationDays: number;
  priceCents: number;
  compareAtPriceCents: number | null;
  label: string | null;
  isActive: boolean;
}

export interface AccessTermInput {
  /** Existing term id to update in place; omit to add a new term. */
  id?: string;
  /** 1–3650, unique per product. 30 = one month, 365 = one year. */
  durationDays: number;
  priceCents: number;
  /** Crossed-out "was" price; must exceed priceCents. */
  compareAtPriceCents?: number | null;
  /** Optional name shown to buyers ("Season pass"). ≤ 80 chars. */
  label?: string | null;
  /** false retires the term. Default true. */
  isActive?: boolean;
}

export interface ProductCreateInput {
  name: string;
  description?: string;
  shortDescription?: string;
  /** Integer minor units — the preferred money field. */
  priceCents?: number;
  compareAtPriceCents?: number | null;
  /**
   * Category UUID from GET /api/categories. Required to publish (a draft may
   * omit it); an unknown or malformed id is a 400, a system category answers
   * category_not_allowed.
   */
  categoryId?: string;
  tags?: string[];
  /**
   * 'active' requires at least one downloadable file in `files`, at least one
   * image and a categoryId — otherwise publish_requires_file /
   * publish_requires_image / publish_requires_category. Default: draft.
   */
  status?: 'active' | 'draft';
  /** Image URLs (external URLs are re-hosted to Getly storage). Max 20. */
  images?: Array<{ url: string; altText?: string }>;
  /**
   * Downloadable files to attach inline. fileUrl MUST be a URL issued by the
   * presign endpoints (uploads to foreign hosts are rejected). Max 50.
   */
  files?: Array<{ fileUrl: string; fileName: string; fileSize: number; fileType?: string }>;
  licenseKeysEnabled?: boolean;
  /** 1-100 (default 3). */
  licenseActivationLimit?: number;
  /** What the buyer may do with the file. Optional; publishing does not require it. */
  licenseType?: ProductLicenseType | null;
  /**
   * Sell YOUR OWN keys: each buyer gets the next unsold key from the pool
   * (add them with products.keys.add once the product exists). Mutually
   * exclusive with licenseKeysEnabled — both true is a 400.
   */
  keyPoolEnabled?: boolean;
  /** 1-1000 (default 5): when the "running low" email is sent. */
  keyPoolLowThreshold?: number;
  /**
   * Timed access — sell access for a period on a ONE-TIME payment (no recurring
   * billing). The buyer picks a term, access ends on a date, buying again extends
   * it; your webhook endpoint receives access.expiring / access.expired. A timed
   * product cannot be published without at least one active term.
   */
  accessMode?: 'lifetime' | 'timed';
  accessTerms?: AccessTermInput[];
}

export interface ProductUpdateInput {
  name?: string;
  description?: string;
  shortDescription?: string;
  priceCents?: number;
  compareAtPriceCents?: number | null;
  categoryId?: string;
  tags?: string[];
  /**
   * 'active' requires an attached file, an image and a categoryId;
   * moderation-locked products 403. categoryId cannot be cleared.
   */
  status?: 'active' | 'draft' | 'archived';
  images?: Array<{ url: string; altText?: string }>;
  licenseKeysEnabled?: boolean;
  licenseActivationLimit?: number;
  /** Set the licence, or `null` to clear it. */
  licenseType?: ProductLicenseType | null;
  /** true turns licenseKeysEnabled off in the same write (and vice versa); both true is a 400. */
  keyPoolEnabled?: boolean;
  keyPoolLowThreshold?: number;
  accessMode?: 'lifetime' | 'timed';
  /** REPLACES the terms table: rows with an id are updated, rows left out are retired. */
  accessTerms?: AccessTermInput[];
}

export interface FilePresign {
  /** PUT the raw bytes here (expires in 1h, Content-Length must match). */
  uploadUrl: string;
  /** Attach this via products.attachFile() after the PUT. */
  fileUrl: string;
  key: string;
  fileName: string;
  fileSize: number;
}

export interface PresignFileInput {
  fileName: string;
  /** Exact byte count — enforced by the presigned PUT signature. */
  fileSize: number;
  fileType?: string;
}

export interface AttachFileInput {
  /** Must be a fileUrl issued by products.presignFile() for your store. */
  fileUrl: string;
  fileName: string;
  fileSize: number;
  fileType?: string;
  versionNotes?: string;
}

export type UploadableData = Uint8Array | ArrayBuffer | Blob;

export interface UploadFileInput {
  fileName: string;
  /** Raw bytes: Buffer/Uint8Array/ArrayBuffer/Blob. Max 2GB. */
  data: UploadableData;
  fileType?: string;
  versionNotes?: string;
}

export interface CreateManyItemResult {
  index: number;
  ok: boolean;
  product?: ProductWithModeration;
  /** GetlyError (or Error) when ok=false. */
  error?: Error;
}

export interface CreateManyOptions {
  /** Parallel workers (default 2 — plays nicely with the 30/min sublimit). */
  concurrency?: number;
  /** Called after each item settles. */
  onProgress?: (result: CreateManyItemResult, completed: number, total: number) => void;
  /**
   * Stable Idempotency-Key prefix — item i is sent with key `${prefix}:${i}`,
   * so re-running the same batch replays already-created products instead of
   * duplicating them.
   */
  idempotencyKeyPrefix?: string;
}

// ---------------------------------------------------------------------------
// Seller key pool (your own license keys)
// ---------------------------------------------------------------------------

export type ProductKeyStatus = 'available' | 'issued';

export interface ProductKey {
  id: string;
  /** Masked (e.g. `ABCD…WXYZ`) — the plaintext is never returned. */
  masked: string;
  status: ProductKeyStatus | string;
  issuedAt: string | null;
  orderItemId: string | null;
  /** The sale this key went to was refunded — revoke the key in your own system. */
  refunded: boolean;
}

export interface ProductKeyPool {
  keyPoolEnabled: boolean;
  keyPoolLowThreshold: number;
  counts: {
    available: number;
    issued: number;
    /** Paid orders waiting because the pool ran out — filled the moment you add keys. */
    waiting: number;
  };
  /** One page, in sale order. */
  keys: ProductKey[];
  limit: number;
  offset: number;
  /** available + issued. */
  total: number;
}

export interface ProductKeyListParams {
  /** 1-100, default 50. */
  limit?: number;
  offset?: number;
}

export interface ProductKeysAddResult {
  added: number;
  /** Already in the pool — not added. */
  duplicates: number;
  /** Repeated within this request — not added. */
  duplicatesInInput: number;
  /** Over 500 characters — not added. */
  tooLong: number;
  blank: number;
  /** Waiting buyers who got a key from this batch. */
  filled: number;
}

// ---------------------------------------------------------------------------
// Posts (creator blog)
// ---------------------------------------------------------------------------

export type PostStatus = 'draft' | 'published';

export interface Post {
  id: string;
  storeId: string;
  title: string;
  slug: string;
  excerpt: string | null;
  /** Markdown source of truth. */
  contentMarkdown: string;
  /** Sanitized HTML derived from the markdown (read-only). */
  contentHtml: string;
  coverImageUrl: string | null;
  visibility: string;
  status: PostStatus | string;
  createdVia: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostListParams extends CursorListParams {
  status?: PostStatus;
}

export interface PostCreateInput {
  title: string;
  /** Markdown only (writes never accept HTML). ≤100KB. */
  contentMarkdown: string;
  excerpt?: string;
  /** https URL — prefer uploads.presignImage() output for guaranteed render. */
  coverImageUrl?: string;
  /** Auto-generated from the title when omitted. */
  slug?: string;
  status?: PostStatus;
}

export interface PostUpdateInput {
  title?: string;
  contentMarkdown?: string;
  excerpt?: string | null;
  coverImageUrl?: string | null;
  slug?: string;
  status?: PostStatus;
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export type CouponType = 'percentage' | 'fixed';

export interface Coupon {
  id: string;
  /** Coupons always belong to a store — platform-wide codes were retired. */
  storeId: string;
  code: string;
  type: CouponType | string;
  /** percentage → 1-100; fixed → cents (see valueCents). */
  value: number;
  /** Present only for fixed coupons — the discount in cents. */
  valueCents?: number;
  minOrderAmountCents: number;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface CouponListParams extends CursorListParams {
  active?: boolean;
}

export interface CouponCreateInput {
  /** 3-50 chars, A-Z 0-9 dashes (normalized to uppercase). */
  code: string;
  type: CouponType;
  /** percentage → integer 1-100; fixed → integer cents (alias: valueCents). */
  value?: number;
  /** Fixed coupons: the discount in cents (preferred over `value`). */
  valueCents?: number;
  minOrderAmountCents?: number;
  maxUses?: number;
  expiresAt?: string;
  /** Required for percentage discounts ≥ 90%. */
  acknowledgeHighDiscount?: boolean;
}

export interface CouponUpdateInput {
  isActive?: boolean;
  expiresAt?: string | null;
  maxUses?: number | null;
}

// ---------------------------------------------------------------------------
// Checkout links
// ---------------------------------------------------------------------------

export type CheckoutLinkStatus = 'open' | 'completed' | 'expired';

export interface CheckoutLink {
  id: string;
  /** Send the buyer here — https://www.getly.store/go/<id>. */
  url: string;
  productId: string;
  status: CheckoutLinkStatus | string;
  reference: string | null;
  metadata: Record<string, string> | null;
  orderId: string | null;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
  currency: 'USD';
  /** Present on create responses. */
  priceCents?: number;
  discountedPriceCents?: number;
  couponApplied?: boolean;
}

export interface CheckoutLinkCreateInput {
  productId: string;
  couponCode?: string;
  affiliateCode?: string;
  /** Your correlation id (≤200 chars) — echoed in sale.completed webhooks. */
  reference?: string;
  /** String-valued object, ≤2KB, ≤20 entries. */
  metadata?: Record<string, string>;
  /** https URL the buyer lands on after payment. */
  successUrl?: string;
  cancelUrl?: string;
  /** 1-720 (default 168 = 7 days). */
  expiresInHours?: number;
}

export interface CheckoutLinkListParams extends CursorListParams {
  status?: CheckoutLinkStatus;
}

/** GET /api/v1/checkout-links/[id] — status polling shape. */
export interface CheckoutLinkPollResult {
  id: string;
  url: string;
  status: CheckoutLinkStatus | string;
  productId: string;
  reference: string | null;
  metadata: Record<string, string> | null;
  orderId: string | null;
  expiresAt: string;
  completedAt: string | null;
}

// ---------------------------------------------------------------------------
// Licenses
// ---------------------------------------------------------------------------

export interface LicenseActivation {
  fingerprint: string;
  label?: string;
  activatedAt: string;
}

export interface LicenseKey {
  id: string;
  key: string;
  productId: string | null;
  status: 'active' | 'deactivated' | string;
  activationLimit: number;
  activationCount: number;
  activations: LicenseActivation[] | null;
  createdAt: string;
}

export interface LicenseListParams extends CursorListParams {
  productId?: string;
}

export type LicenseValidateResult =
  | {
      valid: false;
      /** Set only when a timed-access key's period has ended. */
      reason?: 'expired';
      expiresAt?: string;
    }
  | {
      valid: true;
      productId: string | null;
      status: string;
      activationLimit: number;
      activationCount: number;
      activationsRemaining: number;
      /** End of the timed-access period the key was sold under; null = lifetime. */
      expiresAt: string | null;
    };

export interface LicenseActivateResult {
  activated: boolean;
  alreadyActive: boolean;
  activationsRemaining: number;
}

export interface LicenseDeactivateResult {
  deactivated: boolean;
  wasActive: boolean;
  activationsRemaining: number;
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

export type ImageContentType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/avif';

export interface ImagePresignInput {
  contentType: ImageContentType;
  /** Exact byte count (≤10MB) — enforced by the presigned PUT signature. */
  fileSize: number;
  fileName?: string;
}

export interface ImagePresign {
  /** PUT the raw bytes here (expires in 1h). */
  uploadUrl: string;
  /** Reference this in product images[] / post coverImageUrl. */
  publicUrl: string;
  expiresIn: number;
}

export interface UploadImageInput {
  /** Raw bytes: Buffer/Uint8Array/ArrayBuffer/Blob. Max 10MB. */
  data: UploadableData;
  contentType: ImageContentType;
  fileName?: string;
}

// ---------------------------------------------------------------------------
// Webhook endpoints
// ---------------------------------------------------------------------------

/** Every event a webhook endpoint can subscribe to (the live platform list). */
export const WEBHOOK_EVENT_TYPES = [
  'sale.completed',
  'product.created',
  'product.updated',
  'review.created',
  'download.completed',
  'refund.created',
  'order.refunded',
  'checkout_link.completed',
  'license.activated',
  'access.expiring',
  'access.expired',
  'dispute.created',
  'dispute.resolved',
  'billing.subscription.created',
  'billing.subscription.renewed',
  'billing.payment_failed',
  'billing.subscription.canceled',
  'billing.subscription.expired',
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Subscribable event names, or '*' for all of them. */
export type WebhookEventType = WebhookEventName | '*';

export interface WebhookEndpoint {
  id: string;
  storeId: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  /** HMAC secret — returned ONCE at creation, store it immediately. */
  secret: string;
}

export interface WebhookEndpointCreateInput {
  /** Public https URL (private/internal addresses are rejected). */
  url: string;
  events: WebhookEventType[];
}

export interface WebhookEndpointUpdateInput {
  url?: string;
  events?: WebhookEventType[];
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Store / payouts / orders
// ---------------------------------------------------------------------------

export interface Store {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  website?: string | null;
  socialLinks?: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface StoreCreateInput {
  /** 3-100 characters. */
  name: string;
  /** Optional — auto-generated from the name when omitted. */
  slug?: string;
  description?: string;
}

export interface StoreUpdateInput {
  name?: string;
  description?: string;
  website?: string | null;
  socialLinks?: Record<string, string>;
}

/**
 * @deprecated The endpoint is retired and answers 410 payout_route_retired —
 * this shape is never returned any more. Seller payouts are stablecoin-only
 * (USDT/USDC on BNB Smart Chain, min $5; USDT on Tron, min $15).
 */
export interface PayoutOnboardingResult {
  /** Stripe Connect onboarding link. */
  url: string;
  expiresAt?: string;
}

export interface UpcomingPayout {
  /** Payout run date (1st or 15th, 03:00 UTC). */
  date: string;
  amountCents: number;
  /** 'crypto' for every current payout; 'stripe' only on legacy Connect accounts (held until a wallet is saved). */
  method: 'crypto' | 'stripe' | string;
}

export interface PayoutsSnapshot {
  period: { start: string; end: string };
  balances: {
    pendingCents: number;
    belowMinimumHeldCents: number;
    proPoolHeldCents: number;
    proPoolPendingCents: number;
  };
  thisPeriod: { incomeCents: number; expensesCents: number; netCents: number };
  lifetime: { incomeCents: number; paidOutCents: number; pendingCents: number };
  upcomingPayouts: UpcomingPayout[];
  /** 'crypto' (USDT/USDC); 'stripe' only on legacy accounts whose balance is held until a wallet is saved. */
  payoutMethod: 'crypto' | 'stripe' | string;
  minPayoutCents: number;
  cryptoWalletIncomplete: boolean;
}

export interface OrderItem {
  id: string;
  orderId: string;
  storeId: string;
  productId: string | null;
  /** Line total in cents. */
  price: number;
  sellerAmount?: number;
  platformAmount?: number;
  createdAt: string;
  order?: {
    id: string;
    status: string;
    total: number;
    createdAt: string;
    /** The buyer, including the email they paid with (deliver your own license keys there). */
    buyer?: OrderBuyer | null;
    [key: string]: unknown;
  };
  product?: { id: string; name: string; slug: string } | null;
  [key: string]: unknown;
}

export interface OrderListParams {
  /** 1-based page (this endpoint uses page/limit, not cursors). */
  page?: number;
  /** 1-50, default 20. */
  limit?: number;
}

export interface OrderListResult {
  items: OrderItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface OrderBuyer {
  id: string;
  name: string | null;
  /** The address the buyer paid with (a guest's checkout email counts). */
  email: string | null;
}

export interface Order {
  id: string;
  buyerId: string | null;
  /** Same as buyer.email — the address to deliver your own license keys to. */
  buyerEmail: string | null;
  buyer: OrderBuyer | null;
  status: string;
  /** Cents. */
  total: number;
  createdAt: string;
  /** Only the items belonging to your store. */
  items: OrderItem[];
}

// ---------------------------------------------------------------------------
// Public storefront (no auth)
// ---------------------------------------------------------------------------

/** A buyer payment rail. Card checkout is paused today; read `paymentMethods`. */
export type PaymentMethod = 'card' | 'paypal' | 'crypto';

export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  nameRu?: string;
  nameDe?: string;
  shortDescription: string | null;
  shortDescriptionRu?: string;
  shortDescriptionDe?: string;
  description?: string | null;
  descriptionRu?: string;
  descriptionDe?: string;
  /** Integer minor units. */
  priceCents: number;
  /** Legacy — same cents value as priceCents. */
  price: number;
  currency: 'USD';
  avgRating: number;
  reviewCount: number;
  images: Array<{ url: string; altText: string | null }>;
  urls: { product: string; buy: string };
  /**
   * Single-product endpoint only: the rails a buyer can pay with RIGHT NOW,
   * in display order (card | paypal | crypto). Card is paused today.
   */
  paymentMethods?: PaymentMethod[];
}

export interface PublicStoreProductsResult {
  store: { id: string; name: string; slug: string };
  items: PublicProduct[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Pay Widget public checkout (no auth)
// ---------------------------------------------------------------------------

export interface PublicCheckoutInput {
  /** Widget mint: the store + product slugs (omit when passing linkId). */
  storeSlug?: string;
  productSlug?: string;
  /** Or the id of an API-minted checkout link (its coupon/reference are reused). */
  linkId?: string;
  /** Rail to pay with. Must be live (see PublicProduct.paymentMethods); default = first live rail. */
  method?: PaymentMethod;
  /** Required for paypal and crypto — receipt and download links go here. */
  email?: string;
  /** Card only: 'inline' returns clientSecret + publishableKey. */
  mode?: 'popup' | 'redirect' | 'inline';
  /** https, ≤500 chars. */
  successUrl?: string;
  cancelUrl?: string;
  /** Cloudflare Turnstile token when the previous call answered challenge_required. */
  challengeToken?: string;
}

export interface PublicCheckoutResult {
  method: PaymentMethod;
  /** Hosted payment page (PayPal approval, crypto invoice or card checkout). Absent in card inline mode. */
  url?: string;
  linkId: string;
  priceCents: number;
  currency: 'USD';
  /** Card only. */
  sessionId?: string;
  /** Card inline mode only. */
  clientSecret?: string;
  publishableKey?: string;
}

/** `check: true` — every configuration check, no payment. */
export interface PublicCheckoutCheckResult {
  check: 'ok';
  productName: string;
  productSlug: string;
  priceCents: number;
  currency: 'USD';
  origin: string | null;
  paymentMethods: PaymentMethod[];
  note: string;
}

export interface PublicCheckoutStatus {
  status: 'open' | 'completed' | 'expired';
}

// ---------------------------------------------------------------------------
// Product files / analytics
// ---------------------------------------------------------------------------

export interface SalesAnalytics {
  totalSales: number;
  /** Seller share, integer cents. */
  totalRevenue: number;
  monthlySales: number;
  monthlyRevenue: number;
  averageOrderValue: number;
  productCount: number;
  totalDownloads: number;
  /** Last 6 months. revenue is integer cents. */
  salesByMonth: Array<{ month: string; sales: number; revenue: number }>;
}

// ---------------------------------------------------------------------------
// Getly Billing — recurring plans for your OWN product (scopes read:billing / write:billing)
// ---------------------------------------------------------------------------

export type BillingIntervalUnit = 'day' | 'week' | 'month' | 'year';

export interface BillingInterval {
  unit: BillingIntervalUnit;
  /** 1-52. */
  count: number;
}

export interface BillingPlan {
  id: string;
  name: string;
  description: string | null;
  /** Integer cents charged every interval. */
  amount: number;
  /** Same value as amount. */
  amountCents: number;
  currency: 'usd' | string;
  interval: BillingInterval;
  /** Your own plan id, echoed on webhooks. */
  externalId: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface BillingPlanCreateInput {
  /** 1-255 chars. */
  name: string;
  /** ≤2000 chars. */
  description?: string | null;
  /** Integer cents, minimum 50. */
  amount: number;
  /** Only 'usd' today. */
  currency?: 'usd';
  intervalUnit: BillingIntervalUnit;
  /** 1-52, default 1 ("every 3 months" = month / 3). */
  intervalCount?: number;
  /** Your own plan id (1-128 chars); a duplicate answers 409 plan_exists. */
  externalId?: string | null;
}

/**
 * Amount / interval changes affect NEW subscriptions only; isActive=false
 * stops new checkouts and leaves existing subscribers alone.
 */
export interface BillingPlanUpdateInput {
  name?: string;
  description?: string | null;
  amount?: number;
  intervalUnit?: BillingIntervalUnit;
  intervalCount?: number;
  externalId?: string | null;
  isActive?: boolean;
}

export interface BillingPlanListParams {
  active?: boolean;
}

export interface BillingCheckoutInput {
  planId: string;
  /** YOUR id for this customer (≤255 chars) — echoed as externalCustomerRef. */
  customerRef?: string | null;
  /** https URL on your site. */
  successUrl: string;
  /** https URL on your site. */
  cancelUrl: string;
  /** ≤2KB of string values, echoed on webhooks. */
  metadata?: Record<string, string>;
}

export interface BillingCheckoutResult {
  /** Hosted subscribe page on getly.store — valid 24h. */
  url: string;
  expiresAt: string;
}

export type BillingSubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'expired';

export interface BillingSubscription {
  id: string;
  planId: string;
  /** Present when the plan relation was loaded. */
  plan?: {
    id: string;
    name: string;
    amount: number;
    amountCents: number;
    currency: string;
    interval: BillingInterval;
    externalId: string | null;
  };
  /** The customerRef you sent at checkout. */
  customerRef: string | null;
  /**
   * active · past_due (a card renewal failed) · canceled · expired (a PayPal or
   * crypto period ran out unpaid). Treat active AND past_due as entitled until
   * currentPeriodEnd.
   */
  status: BillingSubscriptionStatus | string;
  /** 'stripe' (card) | 'paypal' | 'crypto'. */
  paymentMethod: 'stripe' | 'paypal' | 'crypto' | string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  metadata: Record<string, string> | null;
}

export interface BillingSubscriptionListParams {
  status?: BillingSubscriptionStatus;
  customerRef?: string;
  planId?: string;
  /** 1-100, default 50. */
  limit?: number;
  offset?: number;
}

export interface BillingSubscriptionListResult {
  items: BillingSubscription[];
  pagination: { limit: number; offset: number; hasMore: boolean };
}

// ---------------------------------------------------------------------------
// Webhook payloads (the `data` of each delivery) — integer cents throughout
// ---------------------------------------------------------------------------

export interface SaleCompletedItem {
  orderItemId: string;
  productId: string | null;
  price: number;
  sellerAmount: number;
  /** A gift: deliver its key to buyerEmail (the giver); the recipient's address is not shared. */
  isGift: boolean;
  /**
   * The key issued for this item (Getly-generated or from your key pool), or
   * null when the product has no keys or the pool was empty — the buyer then
   * gets the key by email as soon as you add more.
   */
  licenseKey: string | null;
}

export interface SaleCompletedPayload {
  orderId: string;
  buyerId: string;
  /** The address the buyer paid with (a guest's checkout email counts). */
  buyerEmail: string | null;
  /** Your store's items only. */
  items: SaleCompletedItem[];
  total: number;
  /** Present when the sale came from a checkout link. */
  checkoutLinkId?: string;
  reference?: string | null;
  metadata?: Record<string, string> | null;
}

export interface ProductEventPayload {
  productId: string;
  name: string;
  slug: string;
  price: number;
  status: string;
}

export interface ReviewCreatedPayload {
  reviewId: string;
  productId: string;
  rating: number;
  title: string | null;
}

export interface DownloadCompletedPayload {
  downloadId: string;
  productId: string | null;
  orderItemId: string;
  fileId: string | null;
  fileName: string | null;
  downloadCount: number;
  remainingDownloads: number;
  downloadedAt: string;
}

export interface RefundCreatedPayload {
  refundRequestId: string;
  orderId: string;
  orderItemId: string | null;
  productName: string | null;
  amountCents: number;
  currency: 'USD';
  reason: string;
  status: string;
  requestedAt: string;
}

export interface OrderRefundedPayload {
  orderId: string;
  orderItemIds: string[];
  amountCents: number;
  currency: 'USD';
  reason?: string;
  refundedAt: string;
}

export interface CheckoutLinkCompletedPayload {
  checkoutLinkId: string;
  orderId: string;
  reference: string | null;
  metadata: Record<string, string> | null;
  amountCents: number;
  currency: 'USD';
}

export interface LicenseActivatedPayload {
  licenseKeyId: string;
  productId: string;
  fingerprint: string;
  activationCount: number;
  activationLimit: number;
}

export interface AccessEventPayload {
  orderItemId: string;
  orderId: string;
  productId: string | null;
  productSlug: string | null;
  durationDays: number | null;
  expiresAt: string;
  buyerEmail: string | null;
}

export interface DisputeEventPayload {
  disputeId: string;
  orderId: string | null;
  orderItemId: string | null;
  reason: string;
  status: string;
  /** dispute.resolved only. */
  resolution?: string | null;
  openedAt?: string;
  resolvedAt?: string;
}

export interface BillingEventPayload {
  event: string;
  subscriptionId: string;
  planId: string;
  plan: BillingSubscription['plan'] | null;
  /** The customerRef you sent at checkout. */
  externalCustomerRef: string | null;
  status: BillingSubscriptionStatus | string;
  paymentMethod: 'stripe' | 'paypal' | 'crypto' | string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Renewals / first payment. */
  paymentId?: string;
  amountPaid?: number;
  amountPaidCents?: number;
  reason?: string;
  metadata: Record<string, string> | null;
}

/** Event name → the `data` payload it carries. */
export interface WebhookPayloadMap {
  'sale.completed': SaleCompletedPayload;
  'product.created': ProductEventPayload;
  'product.updated': ProductEventPayload;
  'review.created': ReviewCreatedPayload;
  'download.completed': DownloadCompletedPayload;
  'refund.created': RefundCreatedPayload;
  'order.refunded': OrderRefundedPayload;
  'checkout_link.completed': CheckoutLinkCompletedPayload;
  'license.activated': LicenseActivatedPayload;
  'access.expiring': AccessEventPayload;
  'access.expired': AccessEventPayload;
  'dispute.created': DisputeEventPayload;
  'dispute.resolved': DisputeEventPayload;
  'billing.subscription.created': BillingEventPayload;
  'billing.subscription.renewed': BillingEventPayload;
  'billing.payment_failed': BillingEventPayload;
  'billing.subscription.canceled': BillingEventPayload;
  'billing.subscription.expired': BillingEventPayload;
}
