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

export interface ProductCreateInput {
  name: string;
  description?: string;
  shortDescription?: string;
  /** Integer minor units — the preferred money field. */
  priceCents?: number;
  compareAtPriceCents?: number | null;
  categoryId?: string;
  tags?: string[];
  /**
   * 'active' requires at least one downloadable file in `files` — otherwise
   * the API answers publish_requires_file. Default: draft.
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
}

export interface ProductUpdateInput {
  name?: string;
  description?: string;
  shortDescription?: string;
  priceCents?: number;
  compareAtPriceCents?: number | null;
  categoryId?: string;
  tags?: string[];
  /** 'active' requires an attached file; moderation-locked products 403. */
  status?: 'active' | 'draft' | 'archived';
  images?: Array<{ url: string; altText?: string }>;
  licenseKeysEnabled?: boolean;
  licenseActivationLimit?: number;
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
  storeId: string | null;
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
  | { valid: false }
  | {
      valid: true;
      productId: string | null;
      status: string;
      activationLimit: number;
      activationCount: number;
      activationsRemaining: number;
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

export type WebhookEventType =
  | 'sale.completed'
  | 'product.created'
  | 'product.updated'
  | 'review.created'
  | 'download.completed'
  | 'refund.created'
  | 'refund.completed'
  | 'order.refunded'
  | 'checkout_link.completed'
  | 'license.activated'
  | 'dispute.created'
  | 'dispute.resolved'
  | 'subscription.created'
  | 'subscription.cancelled'
  | '*';

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

export interface PayoutOnboardingResult {
  /** Stripe Connect onboarding link — open it in a browser. Short-lived. */
  url: string;
  expiresAt?: string;
}

export interface UpcomingPayout {
  date?: string;
  amountCents?: number;
  method?: string;
  [key: string]: unknown;
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
  upcomingPayouts: Array<UpcomingPayout | null>;
  /** 'stripe' | 'crypto'. */
  payoutMethod: string;
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
    buyer?: { id: string; name: string | null } | null;
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

export interface Order {
  id: string;
  buyerId: string | null;
  buyer: { id: string; name: string | null } | null;
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

export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  nameRu?: string;
  nameDe?: string;
  shortDescription: string | null;
  description?: string | null;
  /** Integer minor units. */
  priceCents: number;
  /** Legacy — same cents value as priceCents. */
  price: number;
  currency: 'USD';
  avgRating: number;
  reviewCount: number;
  images: Array<{ url: string; altText: string | null }>;
  urls: { product: string; buy: string };
}

export interface PublicStoreProductsResult {
  store: { id: string; name: string; slug: string };
  items: PublicProduct[];
  nextCursor: string | null;
}
