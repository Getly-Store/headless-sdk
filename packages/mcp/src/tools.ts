/**
 * Getly MCP tool registry — 27 tools.
 *
 * Safety model:
 * - The API key comes ONLY from the GETLY_API_KEY environment variable.
 *   Tools never accept keys as arguments and never echo them.
 * - Destructive / publishing / high-discount actions require `confirm: true`.
 *   Without it the tool REFUSES and tells the model to ask the human first.
 * - There is intentionally NO bulk-delete tool.
 *
 * Every tool talks to the Getly v1 API (https://www.getly.store/developers).
 * Money is ALWAYS integer cents (priceCents / valueCents / *Cents).
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { z, type ZodRawShape } from 'zod';
import { GetlyError, type ImageContentType } from '@getly/sdk';
import { apiRequest, getApiKey, getBaseUrl, getClient, GetlyApiError } from './api.js';
import { searchCategories } from './categories.js';

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface GetlyTool {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: ZodRawShape;
  /** Whether the tool needs GETLY_API_KEY (search_categories is public). */
  requiresAuth: boolean;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

function text(s: string): ToolResult {
  return { content: [{ type: 'text', text: s }] };
}

function json(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function refusal(s: string): ToolResult {
  return { content: [{ type: 'text', text: s }], isError: true };
}

export const MISSING_KEY_MESSAGE = [
  'GETLY_API_KEY is not set — this MCP server reads the Getly API key ONLY from that environment variable (never pass keys as tool arguments, never paste them into chat).',
  '',
  'To set it up, tell the user to:',
  '1. Create an API key at https://www.getly.store/dashboard/developer/keys (grant only the scopes this workflow needs).',
  "2. Run `npx @getly/mcp init` to add the key to their MCP client config, or set GETLY_API_KEY in this server's environment, then restart the MCP client.",
].join('\n');

function formatApiError(err: unknown): ToolResult {
  // GetlyApiError (this package's thin client) and GetlyError (@getly/sdk)
  // carry the same platform error envelope — format them identically.
  if (err instanceof GetlyApiError || err instanceof GetlyError) {
    const retryAfterSeconds =
      err instanceof GetlyError ? err.rateLimit.retryAfterSeconds : err.retryAfterSeconds;
    const lines = [`Getly API error \`${err.code}\` (HTTP ${err.status}): ${err.message}`];
    if (err.param) lines.push(`Field: ${err.param}`);
    if (err.hint) lines.push(`Hint: ${err.hint}`);
    if (err.reasons && err.reasons.length > 0) {
      lines.push('Blockers:');
      for (const r of err.reasons) lines.push(`- ${r.code}: ${r.detail}`);
    }
    if (retryAfterSeconds) lines.push(`Retry after ${retryAfterSeconds}s.`);
    if (err.docsUrl) lines.push(`Docs: ${err.docsUrl}`);
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: true };
  }
  return {
    content: [{ type: 'text', text: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }],
    isError: true,
  };
}

/** Wrap a handler with the missing-key gate + API error formatting. */
function guarded(
  requiresAuth: boolean,
  fn: (args: Record<string, unknown>) => Promise<ToolResult>,
): (args: Record<string, unknown>) => Promise<ToolResult> {
  return async (args) => {
    if (requiresAuth && !getApiKey()) return refusal(MISSING_KEY_MESSAGE);
    try {
      return await fn(args ?? {});
    } catch (err) {
      return formatApiError(err);
    }
  };
}

function confirmRefusal(action: string): ToolResult {
  return refusal(
    `REFUSED: ${action} requires \`confirm: true\`. Do NOT set confirm yourself — ` +
      'first ask the human user to explicitly approve this exact action, and only after ' +
      'they approve, call the tool again with confirm: true.',
  );
}

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------

const cursorParams = {
  limit: z.number().int().min(1).max(100).optional().describe('Page size (default 20, max 100)'),
  cursor: z.string().optional().describe('Opaque nextCursor from the previous page'),
};

const productIdParam = z.string().uuid().describe('Product id (uuid)');

const LICENSE_TYPES = ['personal', 'commercial', 'extended', 'cc0', 'custom'] as const;
const licenseTypeDescription =
  'What the buyer may do with the file: personal, commercial, extended, cc0 or custom. Shown next to the buy button and in the product FAQ. Optional — publishing does not require it, but ask the user rather than guessing: it states their rights, not yours.';

const billingPlanIdParam = z.string().uuid().describe('Billing plan id (uuid)');
const billingSubscriptionIdParam = z.string().uuid().describe('Billing subscription id (uuid)');
const BILLING_NOTE =
  'Getly Billing sells recurring access to the user\'s OWN product (a SaaS, community or tool on their site), not a catalogue listing. Writes need an approved Billing application (billing_not_approved until then — the user applies at https://www.getly.store/dashboard/billing). Key scopes: read:billing / write:billing.';

interface V1ProductLike {
  id: string;
  name: string;
  slug: string;
  status: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  licenseKeysEnabled?: boolean;
  licenseType?: string | null;
  /** Timed access: 'lifetime' (default) or 'timed' — sold as access for a period. */
  accessMode?: 'lifetime' | 'timed' | string;
  accessTerms?: Array<{ id: string; durationDays: number; priceCents: number; compareAtPriceCents: number | null; label: string | null; isActive: boolean }>;
  createdAt?: string;
  category?: { name?: string; slug?: string } | null;
  urls?: { product?: string };
  moderationStatus?: string;
  note?: string;
}

function projectProduct(p: V1ProductLike) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    priceCents: p.priceCents,
    compareAtPriceCents: p.compareAtPriceCents,
    licenseKeysEnabled: p.licenseKeysEnabled,
    licenseType: p.licenseType ?? null,
    accessMode: p.accessMode ?? 'lifetime',
    ...(p.accessTerms ? { accessTerms: p.accessTerms } : {}),
    category: p.category ? { name: p.category.name, slug: p.category.slug } : null,
    url: p.urls?.product,
    createdAt: p.createdAt,
    ...(p.moderationStatus ? { moderationStatus: p.moderationStatus, note: p.note } : {}),
  };
}

const IMAGE_TYPES: Record<string, ImageContentType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

/**
 * Build the canonical Pay Widget embed snippet for a product. The pay.js src is
 * UNVERSIONED (the file updates in place) — never add `integrity=` or `?v=`.
 * Buttons default to `auto` (popup on desktop, redirect on mobile); an explicit
 * mode is stamped only for popup/inline/redirect.
 */
function payWidgetSnippet(baseUrl: string, store: string, product: string, mode: string): string {
  const script = `<script src="${baseUrl}/pay.js" async></script>`;
  if (mode === 'inline') {
    return `${script}\n<div data-getly-buy data-store="${store}" data-product="${product}" data-mode="inline"></div>`;
  }
  const modeAttr = mode === 'popup' || mode === 'redirect' ? ` data-mode="${mode}"` : '';
  return `${script}\n<button data-getly-buy data-store="${store}" data-product="${product}"${modeAttr}>Buy</button>`;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const TOOLS: GetlyTool[] = [
  // ------------------------------------------------------------- products --
  {
    name: 'list_products',
    description:
      "List products in the user's Getly store (cursor-paginated). Filter by status (active/draft/pending_review/archived), category id, or name search. Read-only.",
    annotations: { title: 'List products', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {
      status: z.enum(['active', 'draft', 'pending_review', 'archived']).optional()
        .describe('Filter by status (default: active)'),
      search: z.string().optional().describe('Case-insensitive name search'),
      category: z.string().optional().describe('Category id filter'),
      ...cursorParams,
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<{ items: V1ProductLike[]; nextCursor: string | null }>(
        'api/v1/products',
        {
          query: {
            status: args.status as string | undefined,
            search: args.search as string | undefined,
            category: args.category as string | undefined,
            limit: args.limit as number | undefined,
            cursor: args.cursor as string | undefined,
          },
        },
      );
      return json({
        items: env.data.items.map(projectProduct),
        nextCursor: env.data.nextCursor,
      });
    }),
  },

  {
    name: 'get_product',
    description:
      'Get full details of one product by id: description, priceCents, images, attached files, category, recent reviews, public URLs. Read-only.',
    annotations: { title: 'Get product', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: { productId: productIdParam },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<Record<string, unknown>>(`api/v1/products/${args.productId}`);
      const data = { ...env.data };
      if (Array.isArray(data.reviews) && data.reviews.length > 5) {
        data.reviews = data.reviews.slice(0, 5);
        data.reviewsTruncated = true;
      }
      return json(data);
    }),
  },

  {
    name: 'create_product',
    description:
      'Create a product in the Getly store (side effect: creates a DRAFT product; money is integer cents). A product cannot go live without a downloadable file, at least one image and a categoryId — attach the file with upload_product_file, then use publish_product. Daily cap: 100 products per API key.',
    annotations: { title: 'Create product' },
    requiresAuth: true,
    inputSchema: {
      name: z.string().min(1).max(200).describe('Product name'),
      priceCents: z.number().int().min(0)
        .describe('Price in integer cents (e.g. 1999 = $19.99; 0 = free)'),
      description: z.string().optional().describe('Long description (plain text or simple HTML)'),
      shortDescription: z.string().max(500).optional().describe('One-line summary'),
      compareAtPriceCents: z.number().int().min(0).optional()
        .describe('Strike-through "was" price in cents (must be above priceCents to make sense)'),
      categoryId: z.string().uuid().optional()
        .describe('Category id (uuid) — find one with search_categories. Required before publishing.'),
      tags: z.array(z.string()).max(20).optional().describe('Search tags'),
      images: z.array(z.object({
        url: z.string().url().describe('Image URL (upload local files first via upload_image)'),
        altText: z.string().max(255).optional(),
      })).max(20).optional().describe('Product images (first = cover)'),
      licenseKeysEnabled: z.boolean().optional()
        .describe('Issue a license key with every sale'),
      licenseActivationLimit: z.number().int().min(1).max(100).optional()
        .describe('Activation seats per license key (default 3)'),
      licenseType: z.enum(LICENSE_TYPES).optional().describe(licenseTypeDescription),
      accessMode: z.enum(['lifetime', 'timed']).optional()
        .describe("How it is sold. 'timed' = access for a period on a ONE-TIME payment (no recurring billing): the buyer picks a term, access ends on a date, buying again extends it. Default 'lifetime'."),
      accessTerms: z.array(z.object({
        id: z.string().optional().describe('Existing term id (update in place); omit for a new term'),
        durationDays: z.number().int().min(1).max(3650).describe('Length of access in days (30 = 1 month, 365 = 1 year); unique per product'),
        priceCents: z.number().int().min(0).describe('Price of this term in integer cents'),
        compareAtPriceCents: z.number().int().min(0).optional().describe('Crossed-out "was" price in cents; must exceed priceCents'),
        label: z.string().max(80).optional().describe('Optional name shown to buyers, e.g. "Season pass"'),
        isActive: z.boolean().optional().describe('false retires the term (default true)'),
      })).max(6).optional()
        .describe("The periods on offer when accessMode is 'timed'. On update this REPLACES the table: rows with an id are updated, rows left out are retired. A timed product cannot be published without at least one active term."),
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<V1ProductLike & Record<string, unknown>>('api/v1/products', {
        method: 'POST',
        idempotent: true,
        body: {
          name: args.name,
          priceCents: args.priceCents,
          description: args.description,
          shortDescription: args.shortDescription,
          compareAtPriceCents: args.compareAtPriceCents,
          categoryId: args.categoryId,
          tags: args.tags,
          images: args.images,
          licenseKeysEnabled: args.licenseKeysEnabled,
          licenseActivationLimit: args.licenseActivationLimit,
          licenseType: args.licenseType,
          accessMode: args.accessMode,
          accessTerms: args.accessTerms,
          status: 'draft',
        },
      });
      return json({
        created: projectProduct(env.data),
        nextSteps:
          'The product is a draft. Attach a downloadable file with upload_product_file, then publish with publish_product (needs human confirmation).',
      });
    }),
  },

  {
    name: 'update_product',
    description:
      'Update fields of an existing product (side effect: modifies the live listing). Cannot publish or archive from here — use publish_product / archive_product, which require human confirmation. Money is integer cents.',
    annotations: { title: 'Update product', idempotentHint: true },
    requiresAuth: true,
    inputSchema: {
      productId: productIdParam,
      name: z.string().min(1).max(200).optional(),
      priceCents: z.number().int().min(0).optional().describe('New price in integer cents'),
      description: z.string().optional(),
      shortDescription: z.string().max(500).optional(),
      compareAtPriceCents: z.number().int().min(0).nullable().optional()
        .describe('Strike-through price in cents; null clears it'),
      categoryId: z.string().uuid().optional().describe('Category id (uuid) from search_categories; cannot be cleared'),
      tags: z.array(z.string()).max(20).optional(),
      images: z.array(z.object({
        url: z.string().url(),
        altText: z.string().max(255).optional(),
      })).max(20).optional().describe('REPLACES the whole image set when provided'),
      status: z.enum(['draft']).optional()
        .describe("Only 'draft' (unpublish) is allowed here. Publishing requires publish_product; archiving requires archive_product — both need human confirmation."),
      licenseKeysEnabled: z.boolean().optional(),
      licenseActivationLimit: z.number().int().min(1).max(100).optional(),
      licenseType: z.enum(LICENSE_TYPES).nullable().optional()
        .describe(`${licenseTypeDescription} null clears it.`),
      accessMode: z.enum(['lifetime', 'timed']).optional()
        .describe("How it is sold. 'timed' = access for a period on a ONE-TIME payment (no recurring billing): the buyer picks a term, access ends on a date, buying again extends it. Default 'lifetime'."),
      accessTerms: z.array(z.object({
        id: z.string().optional().describe('Existing term id (update in place); omit for a new term'),
        durationDays: z.number().int().min(1).max(3650).describe('Length of access in days (30 = 1 month, 365 = 1 year); unique per product'),
        priceCents: z.number().int().min(0).describe('Price of this term in integer cents'),
        compareAtPriceCents: z.number().int().min(0).optional().describe('Crossed-out "was" price in cents; must exceed priceCents'),
        label: z.string().max(80).optional().describe('Optional name shown to buyers, e.g. "Season pass"'),
        isActive: z.boolean().optional().describe('false retires the term (default true)'),
      })).max(6).optional()
        .describe("The periods on offer when accessMode is 'timed'. On update this REPLACES the table: rows with an id are updated, rows left out are retired. A timed product cannot be published without at least one active term."),
    },
    handler: guarded(true, async (args) => {
      const { productId, ...rest } = args;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
      const env = await apiRequest<V1ProductLike>(`api/v1/products/${productId}`, {
        method: 'PATCH',
        body,
      });
      return json({ updated: projectProduct(env.data) });
    }),
  },

  {
    name: 'publish_product',
    description:
      'Publish a draft product so it becomes publicly purchasable (side effect: goes live and can take real money). REQUIRES confirm: true — ask the human user for explicit approval first. New stores without a completed sale go to moderation review instead of straight live. Returns machine-readable blockers if the product is not ready (e.g. missing downloadable file).',
    annotations: { title: 'Publish product' },
    requiresAuth: true,
    inputSchema: {
      productId: productIdParam,
      confirm: z.boolean().optional()
        .describe('Must be true. Only set it after the human user explicitly approved publishing THIS product.'),
    },
    handler: guarded(true, async (args) => {
      if (args.confirm !== true) {
        return confirmRefusal(`publish_product (product ${String(args.productId)} would go live and become purchasable)`);
      }
      const env = await apiRequest<V1ProductLike & { moderationStatus?: string; note?: string }>(
        `api/v1/products/${args.productId}/publish`,
        { method: 'POST', idempotent: true },
      );
      const p = env.data;
      const summary =
        p.status === 'active'
          ? `Published — the product is live at ${p.urls?.product ?? 'its product page'}.`
          : `Submitted — the product is in moderation review (status: ${p.status}). ${p.note ?? ''}`.trim();
      return json({ result: summary, product: projectProduct(p) });
    }),
  },

  {
    name: 'archive_product',
    description:
      'Archive (soft-delete) a product: it disappears from the store and stops selling; existing buyers keep their downloads. DESTRUCTIVE — REQUIRES confirm: true; ask the human user for explicit approval first. Reversible only by re-publishing later.',
    annotations: { title: 'Archive product', destructiveHint: true },
    requiresAuth: true,
    inputSchema: {
      productId: productIdParam,
      confirm: z.boolean().optional()
        .describe('Must be true. Only set it after the human user explicitly approved archiving THIS product.'),
    },
    handler: guarded(true, async (args) => {
      if (args.confirm !== true) {
        return confirmRefusal(`archive_product (product ${String(args.productId)} would be removed from sale)`);
      }
      const env = await apiRequest<{ id: string; status: string }>(
        `api/v1/products/${args.productId}`,
        { method: 'DELETE' },
      );
      return json({ result: 'Product archived (removed from sale).', ...env.data });
    }),
  },

  {
    name: 'upload_product_file',
    description:
      'Upload a local file as the downloadable a buyer receives (side effect: attaches the file to the product). SLOW for large files (up to 2GB) — the bytes are read from disk and uploaded to storage; do not retry while a call is still running. Flow: presigned URL → upload → attach.',
    annotations: { title: 'Upload product file (slow)' },
    requiresAuth: true,
    inputSchema: {
      productId: productIdParam,
      filePath: z.string().describe('Absolute path of the local file to upload'),
      fileType: z.string().optional()
        .describe('MIME type (default application/octet-stream)'),
      versionNotes: z.string().max(2000).optional().describe('Changelog note for this file version'),
    },
    handler: guarded(true, async (args) => {
      const filePath = String(args.filePath);
      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile()) return refusal(`File not found (or not a regular file): ${filePath}`);
      const fileName = basename(filePath);
      const fileType = (args.fileType as string | undefined) || 'application/octet-stream';

      // @getly/sdk one-call flow: presign → PUT the bytes → attach.
      const bytes = await readFile(filePath);
      const file = await getClient().products.uploadFile(String(args.productId), {
        fileName,
        data: bytes,
        fileType,
        versionNotes: args.versionNotes as string | undefined,
      });
      return json({
        result: `Attached "${fileName}" (${info.size} bytes) to the product.`,
        file,
      });
    }),
  },

  {
    name: 'upload_image',
    description:
      'Upload a local image (png/jpg/webp/gif/avif, max 10MB) to Getly storage and return its public URL — use that URL in create_product/update_product images[] or as a blog post coverImageUrl. Side effect: stores the image (auto-deleted after 24h if never attached to anything).',
    annotations: { title: 'Upload image' },
    requiresAuth: true,
    inputSchema: {
      filePath: z.string().describe('Absolute path of the local image file'),
    },
    handler: guarded(true, async (args) => {
      const filePath = String(args.filePath);
      const contentType = IMAGE_TYPES[extname(filePath).toLowerCase()];
      if (!contentType) {
        return refusal('Unsupported image type. Allowed: .png, .jpg/.jpeg, .webp, .gif, .avif');
      }
      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile()) return refusal(`File not found (or not a regular file): ${filePath}`);
      if (info.size > 10 * 1024 * 1024) return refusal('Image too large — max 10MB.');

      // @getly/sdk one-call flow: presignImage → PUT the bytes.
      const bytes = await readFile(filePath);
      const { publicUrl } = await getClient().uploads.uploadImage({
        data: bytes,
        contentType,
        fileName: basename(filePath),
      });
      return json({
        url: publicUrl,
        note: 'Use this URL as a product image or a blog post cover within 24 hours, or it will be garbage-collected.',
      });
    }),
  },

  // ----------------------------------------------------------------- blog --
  {
    name: 'create_blog_post',
    description:
      "Create a blog post on the user's Getly store (side effect: creates a draft, or publishes immediately when status=published). Markdown is the source of truth; embed a product buy-card with the [product:slug] shortcode. Daily cap: 5 posts per API key. New stores' posts are noindex until the store is trusted.",
    annotations: { title: 'Create blog post' },
    requiresAuth: true,
    inputSchema: {
      title: z.string().min(1).max(500).describe('Post title'),
      contentMarkdown: z.string().min(1)
        .describe('Post body in Markdown (max 100KB). Use [product:slug] to embed a product card with a buy button.'),
      excerpt: z.string().max(500).optional().describe('Short teaser shown in lists'),
      coverImageUrl: z.string().url().optional()
        .describe('Cover image URL (upload local images first via upload_image)'),
      slug: z.string().optional().describe('URL slug override (auto-generated from the title when omitted)'),
      status: z.enum(['draft', 'published']).optional()
        .describe('draft (default) or published (goes live immediately)'),
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<Record<string, unknown>>('api/v1/posts', {
        method: 'POST',
        idempotent: true,
        body: {
          title: args.title,
          contentMarkdown: args.contentMarkdown,
          excerpt: args.excerpt,
          coverImageUrl: args.coverImageUrl,
          slug: args.slug,
          status: args.status,
        },
      });
      const data = { ...env.data };
      delete data.contentHtml; // token-heavy derived field
      return json({ post: data, ...(env.warnings ? { warnings: env.warnings } : {}) });
    }),
  },

  {
    name: 'list_blog_posts',
    description:
      "List the store's blog posts (cursor-paginated, filter by draft/published). Read-only.",
    annotations: { title: 'List blog posts', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {
      status: z.enum(['draft', 'published']).optional().describe('Status filter'),
      ...cursorParams,
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<{ items: Array<Record<string, unknown>>; nextCursor: string | null }>(
        'api/v1/posts',
        {
          query: {
            status: args.status as string | undefined,
            limit: args.limit as number | undefined,
            cursor: args.cursor as string | undefined,
          },
        },
      );
      const items = env.data.items.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        status: p.status,
        excerpt: p.excerpt,
        publishedAt: p.publishedAt,
        createdAt: p.createdAt,
      }));
      return json({ items, nextCursor: env.data.nextCursor });
    }),
  },

  // -------------------------------------------------------------- coupons --
  {
    name: 'create_coupon',
    description:
      'Create a discount coupon (side effect: buyers can immediately redeem it and pay less). type=percentage → value is 1-100; type=fixed → value is integer CENTS off. Discounts of 50%+ REQUIRE confirm: true — ask the human user first. Daily cap: 30 coupons per API key.',
    annotations: { title: 'Create coupon' },
    requiresAuth: true,
    inputSchema: {
      code: z.string().min(3).max(50)
        .describe('Coupon code (3-50 chars, letters/digits/dashes; normalized to UPPERCASE)'),
      type: z.enum(['percentage', 'fixed']).describe('percentage of the order, or fixed cents off'),
      value: z.number().int().min(1)
        .describe('percentage: 1-100; fixed: integer cents off (e.g. 500 = $5.00)'),
      minOrderAmountCents: z.number().int().min(0).optional()
        .describe('Minimum order total in cents to qualify'),
      maxUses: z.number().int().min(1).optional()
        .describe('Total redemption limit (unlimited when omitted)'),
      expiresAt: z.string().optional()
        .describe('Expiry date (ISO 8601; date-only means end of that day)'),
      confirm: z.boolean().optional()
        .describe('Required (true) when the discount is a percentage of 50 or more. Only set it after the human user explicitly approved this discount.'),
    },
    handler: guarded(true, async (args) => {
      const type = args.type as string;
      const value = args.value as number;
      if (type === 'percentage' && value >= 50 && args.confirm !== true) {
        return confirmRefusal(
          `create_coupon with a ${value}% discount (this cuts real revenue on every redemption)`,
        );
      }
      const env = await apiRequest<Record<string, unknown>>('api/v1/coupons', {
        method: 'POST',
        idempotent: true,
        body: {
          code: args.code,
          type,
          value,
          minOrderAmountCents: args.minOrderAmountCents,
          maxUses: args.maxUses,
          expiresAt: args.expiresAt,
          // The API separately requires this acknowledgement at >=90%; the
          // human already confirmed via the 50%+ confirm gate above.
          ...(type === 'percentage' && value >= 90 ? { acknowledgeHighDiscount: true } : {}),
        },
      });
      return json({ coupon: env.data });
    }),
  },

  {
    name: 'list_coupons',
    description: "List the store's coupons (cursor-paginated, filter by active). Read-only.",
    annotations: { title: 'List coupons', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {
      active: z.boolean().optional().describe('Filter: only active (true) / only inactive (false)'),
      ...cursorParams,
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<{ items: Array<Record<string, unknown>>; nextCursor: string | null }>(
        'api/v1/coupons',
        {
          query: {
            active: args.active as boolean | undefined,
            limit: args.limit as number | undefined,
            cursor: args.cursor as string | undefined,
          },
        },
      );
      const items = env.data.items.map((c) => ({
        id: c.id,
        code: c.code,
        type: c.type,
        value: c.value,
        ...(c.type === 'fixed' ? { valueCents: c.valueCents ?? c.value } : {}),
        minOrderAmountCents: c.minOrderAmountCents,
        maxUses: c.maxUses,
        usedCount: c.usedCount,
        isActive: c.isActive,
        expiresAt: c.expiresAt,
      }));
      return json({ items, nextCursor: env.data.nextCursor });
    }),
  },

  // ------------------------------------------------------- checkout links --
  {
    name: 'create_checkout_link',
    description:
      'Create an instant payment link for one product (side effect: anyone with the URL can buy; an optional coupon is auto-applied at checkout). Idempotent per (product, coupon, reference): re-creating with the same trio returns the existing open link. Default expiry 7 days (max 30). Poll completion with get_checkout_link_status.',
    annotations: { title: 'Create checkout link', idempotentHint: true },
    requiresAuth: true,
    inputSchema: {
      productId: productIdParam,
      couponCode: z.string().max(50).optional()
        .describe('Coupon code to auto-apply (validated now and again at redemption)'),
      affiliateCode: z.string().max(50).optional()
        .describe('Attribute the sale to this affiliate (self-referral is rejected)'),
      reference: z.string().max(200).optional()
        .describe('Your correlation id — echoed in webhooks and status polling'),
      metadata: z.record(z.string(), z.string()).optional()
        .describe('Up to 20 string key/values (≤2KB) echoed in sale.completed'),
      successUrl: z.string().url().optional().describe('https URL the buyer lands on after paying'),
      cancelUrl: z.string().url().optional().describe('https URL when the buyer cancels'),
      expiresInHours: z.number().int().min(1).max(720).optional()
        .describe('Link lifetime in hours (default 168 = 7 days, max 720)'),
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<Record<string, unknown>>('api/v1/checkout-links', {
        method: 'POST',
        idempotent: true,
        body: {
          productId: args.productId,
          couponCode: args.couponCode,
          affiliateCode: args.affiliateCode,
          reference: args.reference,
          metadata: args.metadata,
          successUrl: args.successUrl,
          cancelUrl: args.cancelUrl,
          expiresInHours: args.expiresInHours,
        },
      });
      const d = env.data;
      return json({
        url: d.url,
        id: d.id,
        status: d.status,
        priceCents: d.priceCents,
        discountedPriceCents: d.discountedPriceCents,
        couponApplied: d.couponApplied,
        reference: d.reference,
        expiresAt: d.expiresAt,
      });
    }),
  },

  {
    name: 'get_checkout_link_status',
    description:
      'Check whether a checkout link was paid: returns open | completed | expired (+ orderId when completed). Use this to poll for payment when you cannot receive webhooks. Read-only.',
    annotations: { title: 'Checkout link status', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {
      linkId: z.string().uuid().describe('Checkout link id (from create_checkout_link)'),
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<Record<string, unknown>>(`api/v1/checkout-links/${args.linkId}`);
      return json(env.data);
    }),
  },

  // ------------------------------------------------------------- licenses --
  {
    name: 'list_licenses',
    description:
      "List license keys issued for the store's products (cursor-paginated, filter by productId). Shows activation counts and devices. Read-only.",
    annotations: { title: 'List license keys', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {
      productId: z.string().uuid().optional().describe('Only keys of this product'),
      ...cursorParams,
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<{ items: unknown[]; nextCursor: string | null }>(
        'api/v1/licenses',
        {
          query: {
            productId: args.productId as string | undefined,
            limit: args.limit as number | undefined,
            cursor: args.cursor as string | undefined,
          },
        },
      );
      return json(env.data);
    }),
  },

  // ---------------------------------------------------------------- stats --
  {
    name: 'get_sales_stats',
    description:
      'Sales overview for the store: total/monthly sales and revenue (integer cents), average order value, per-month breakdown, product count, downloads, plus the most recent orders. Read-only. Revenue figures are the SELLER share (after the platform fee).',
    annotations: { title: 'Sales stats', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {},
    handler: guarded(true, async () => {
      const analytics = await apiRequest<{
        totalSales: number;
        totalRevenue: number;
        monthlySales: number;
        monthlyRevenue: number;
        averageOrderValue: number;
        productCount: number;
        totalDownloads: number;
        salesByMonth: Array<{ month: string; sales: number; revenue: number }>;
      }>('api/v1/analytics');
      const a = analytics.data;

      // Recent orders are a nice-to-have — degrade gracefully when the key
      // lacks read:orders.
      let recentOrders: unknown = 'unavailable (key lacks the read:orders scope)';
      try {
        const orders = await apiRequest<Array<Record<string, unknown>>>('api/v1/orders', {
          query: { limit: 5 },
        });
        recentOrders = (orders.data ?? []).map((i) => {
          const product = i.product as { name?: string; slug?: string } | null;
          const order = i.order as { id?: string; status?: string; createdAt?: string } | null;
          return {
            orderItemId: i.id,
            product: product?.name,
            sellerAmountCents: i.sellerAmount,
            orderStatus: order?.status,
            createdAt: i.createdAt,
          };
        });
      } catch {
        /* keep the fallback note */
      }

      return json({
        totalSales: a.totalSales,
        totalRevenueCents: a.totalRevenue,
        monthlySales: a.monthlySales,
        monthlyRevenueCents: a.monthlyRevenue,
        averageOrderValueCents: a.averageOrderValue,
        productCount: a.productCount,
        totalDownloads: a.totalDownloads,
        salesByMonth: (a.salesByMonth ?? []).map((m) => ({
          month: m.month,
          sales: Number(m.sales),
          revenueCents: Number(m.revenue),
        })),
        recentOrders,
      });
    }),
  },


  // --------------------------------------------------------------- orders --
  {
    name: 'list_orders',
    description:
      "List the store's sold order items, newest first (page/limit pagination): product, seller amount in integer cents, order status, and the buyer's name and email — the address to deliver your own license keys or onboarding to. Read-only. Needs the read:orders scope. Treat buyer emails as personal data: use them for this order only.",
    annotations: { title: 'List orders', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {
      page: z.number().int().min(1).optional().describe('1-based page (default 1)'),
      limit: z.number().int().min(1).max(50).optional().describe('Items per page (default 20, max 50)'),
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<Array<Record<string, unknown>>>('api/v1/orders', {
        query: { page: args.page as number | undefined, limit: args.limit as number | undefined },
      });
      const items = (env.data ?? []).map((i) => {
        const product = i.product as { id?: string; name?: string; slug?: string } | null;
        const order = i.order as {
          id?: string;
          status?: string;
          total?: number;
          createdAt?: string;
          buyer?: { name?: string | null; email?: string | null } | null;
        } | null;
        return {
          orderItemId: i.id,
          orderId: i.orderId,
          product: product ? { id: product.id, name: product.name, slug: product.slug } : null,
          priceCents: i.price,
          sellerAmountCents: i.sellerAmount,
          orderStatus: order?.status,
          buyerName: order?.buyer?.name ?? null,
          buyerEmail: order?.buyer?.email ?? null,
          createdAt: i.createdAt,
        };
      });
      return json({ items, total: env.total, page: env.page, hasMore: env.hasMore });
    }),
  },

  // -------------------------------------------------------------- billing --
  {
    name: 'list_billing_plans',
    description: `List the store's Getly Billing plans (recurring prices, integer cents). Read-only. ${BILLING_NOTE}`,
    annotations: { title: 'List billing plans', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {
      active: z.boolean().optional().describe('Only active (true) / only inactive (false)'),
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<unknown[]>('api/v1/billing/plans', {
        query: { active: args.active as boolean | undefined },
      });
      return json(env.data);
    }),
  },

  {
    name: 'create_billing_plan',
    description: `Create a Getly Billing plan: an amount in integer cents (minimum 50) charged every interval (side effect: the plan can be sold as soon as a checkout is minted). Subscribers pay with PayPal or USDT/USDC today — one payment buys one period — or by card when that rail is live. ${BILLING_NOTE}`,
    annotations: { title: 'Create billing plan' },
    requiresAuth: true,
    inputSchema: {
      name: z.string().min(1).max(255).describe('Plan name shown to subscribers'),
      amount: z.number().int().min(50).describe('Price per interval in integer cents (1900 = $19.00)'),
      intervalUnit: z.enum(['day', 'week', 'month', 'year']).describe('Billing interval unit'),
      intervalCount: z.number().int().min(1).max(52).optional()
        .describe('Units per interval (default 1): every 3 months = month + 3'),
      description: z.string().max(2000).optional(),
      externalId: z.string().min(1).max(128).optional()
        .describe('Your own plan id, echoed on webhooks (a duplicate answers plan_exists)'),
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<Record<string, unknown>>('api/v1/billing/plans', {
        method: 'POST',
        idempotent: true,
        body: {
          name: args.name,
          amount: args.amount,
          intervalUnit: args.intervalUnit,
          intervalCount: args.intervalCount,
          description: args.description,
          externalId: args.externalId,
        },
      });
      return json({ plan: env.data });
    }),
  },

  {
    name: 'update_billing_plan',
    description: `Update a Getly Billing plan. A price or interval change affects NEW subscriptions only — existing subscribers keep what they signed up at. isActive=false stops new checkouts and leaves current subscribers alone. ${BILLING_NOTE}`,
    annotations: { title: 'Update billing plan', idempotentHint: true },
    requiresAuth: true,
    inputSchema: {
      planId: billingPlanIdParam,
      name: z.string().min(1).max(255).optional(),
      amount: z.number().int().min(50).optional().describe('New price in integer cents'),
      intervalUnit: z.enum(['day', 'week', 'month', 'year']).optional(),
      intervalCount: z.number().int().min(1).max(52).optional(),
      description: z.string().max(2000).nullable().optional(),
      externalId: z.string().min(1).max(128).nullable().optional(),
      isActive: z.boolean().optional(),
    },
    handler: guarded(true, async (args) => {
      const { planId, ...rest } = args;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
      const env = await apiRequest<Record<string, unknown>>(`api/v1/billing/plans/${planId}`, {
        method: 'PATCH',
        body,
      });
      return json({ plan: env.data });
    }),
  },

  {
    name: 'create_billing_checkout',
    description: `Mint a hosted subscribe page (valid 24 hours) for ONE customer of the user's own product. The customer signs in or creates a Getly account, sees the plan and pays. customerRef is the user's own id for that customer and comes back on every billing.* webhook as externalCustomerRef. ${BILLING_NOTE}`,
    annotations: { title: 'Create billing checkout' },
    requiresAuth: true,
    inputSchema: {
      planId: billingPlanIdParam,
      customerRef: z.string().max(255).optional().describe("The user's own id for this customer"),
      successUrl: z.string().url().describe('https URL on the user\'s site where the subscriber lands after paying'),
      cancelUrl: z.string().url().describe('https URL on the user\'s site for a cancelled checkout'),
      metadata: z.record(z.string(), z.string()).optional().describe('Up to 2KB of string values, echoed on webhooks'),
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<{ url: string; expiresAt: string }>('api/v1/billing/checkout', {
        method: 'POST',
        idempotent: true,
        body: {
          planId: args.planId,
          customerRef: args.customerRef,
          successUrl: args.successUrl,
          cancelUrl: args.cancelUrl,
          metadata: args.metadata,
        },
      });
      return json(env.data);
    }),
  },

  {
    name: 'list_billing_subscriptions',
    description: `List subscriptions to the store's Getly Billing plans, newest first (limit/offset). Filter by status, the user's customerRef or planId. Read-only. ${BILLING_NOTE}`,
    annotations: { title: 'List billing subscriptions', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {
      status: z.enum(['active', 'past_due', 'canceled', 'expired']).optional(),
      customerRef: z.string().optional().describe('The customerRef sent at checkout'),
      planId: billingPlanIdParam.optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Page size (default 50)'),
      offset: z.number().int().min(0).optional(),
    },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<unknown[]>('api/v1/billing/subscriptions', {
        query: {
          status: args.status as string | undefined,
          customerRef: args.customerRef as string | undefined,
          planId: args.planId as string | undefined,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        },
      });
      return json({ items: env.data, pagination: env.pagination });
    }),
  },

  {
    name: 'get_billing_subscription',
    description: `Get one Getly Billing subscription — the check before granting access. Treat status active AND past_due as entitled until currentPeriodEnd; canceled and expired are not. Read-only. ${BILLING_NOTE}`,
    annotations: { title: 'Get billing subscription', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: { subscriptionId: billingSubscriptionIdParam },
    handler: guarded(true, async (args) => {
      const env = await apiRequest<Record<string, unknown>>(`api/v1/billing/subscriptions/${args.subscriptionId}`);
      return json(env.data);
    }),
  },

  {
    name: 'cancel_billing_subscription',
    description: `Stop a Getly Billing subscription from renewing (side effect: the customer is not charged again; they keep access to the end of the paid period — never an immediate cut-off). REQUIRES confirm: true — ask the human user first. ${BILLING_NOTE}`,
    annotations: { title: 'Cancel billing subscription', destructiveHint: true, idempotentHint: true },
    requiresAuth: true,
    inputSchema: {
      subscriptionId: billingSubscriptionIdParam,
      confirm: z.boolean().optional()
        .describe('Must be true. Only set it after the human user explicitly approved cancelling THIS subscription.'),
    },
    handler: guarded(true, async (args) => {
      if (args.confirm !== true) {
        return confirmRefusal(`cancel_billing_subscription (subscription ${String(args.subscriptionId)} would stop renewing)`);
      }
      const env = await apiRequest<Record<string, unknown>>(
        `api/v1/billing/subscriptions/${args.subscriptionId}/cancel`,
        { method: 'POST', idempotent: true },
      );
      return json({ result: 'Renewal stopped; access continues to the end of the paid period.', subscription: env.data });
    }),
  },

  // ----------------------------------------------------------- categories --
  {
    name: 'search_categories',
    description:
      'Find Getly category ids by fuzzy name search (e.g. "icons", "3d models", "fonts") over the public 700+ category tree. Use the returned id as categoryId in create_product/update_product. Read-only, no API key needed, cached 1h.',
    annotations: { title: 'Search categories', readOnlyHint: true },
    requiresAuth: false,
    inputSchema: {
      query: z.string().min(1).describe('Category name or keywords'),
      limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
    },
    handler: guarded(false, async (args) => {
      const matches = await searchCategories(String(args.query), (args.limit as number) ?? 10);
      if (matches.length === 0) {
        return text(
          `No categories matched "${String(args.query)}". Try a broader keyword (e.g. "graphics", "audio", "templates").`,
        );
      }
      return json(matches.map(({ id, name, slug, path }) => ({ id, name, slug, path })));
    }),
  },

  // ------------------------------------------------------------------ store --
  {
    name: 'get_store',
    description:
      "Get the user's store profile: name, slug, description, verification, public URL. Read-only.",
    annotations: { title: 'Get store', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {},
    handler: guarded(true, async () => {
      const env = await apiRequest<Record<string, unknown>>('api/v1/store');
      const s = env.data;
      return json({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description,
        website: s.website,
        isVerified: s.isVerified,
        commissionPercent: s.commissionPercent,
        createdAt: s.createdAt,
        url: `${getBaseUrl()}/store/${String(s.slug)}`,
      });
    }),
  },

  // ---------------------------------------------------------- pay widget --
  {
    name: 'get_pay_widget_code',
    description:
      'Generate the Pay Widget embed snippet (a <script> tag + a Buy button/div) that sells ONE of your products from ANY external website — a landing page, quiz funnel, link-in-bio, Webflow/Framer/Carrd site. The button asks for the buyer\'s email and offers every rail that is live — PayPal and USDT/USDC today (card checkout is paused; it reappears on its own when it returns). Getly handles delivery, receipts, refunds and the payout. The store must be approved for the Pay Widget first (the seller requests access at /dashboard/pay-widget). No API key ever touches the browser. Validates that the product is active and publicly purchasable first. Read-only — it only returns code, it changes nothing.',
    annotations: { title: 'Get Pay Widget embed code', readOnlyHint: true },
    requiresAuth: true,
    inputSchema: {
      productSlug: z.string().min(1)
        .describe('The product SLUG (from list_products → slug, or the product URL) — not the uuid.'),
      mode: z.enum(['auto', 'popup', 'inline', 'redirect']).optional()
        .describe("Embed mode. auto (default): popup on desktop, same-tab redirect on mobile. popup: always a popup. inline: the email field and payment buttons rendered inside a <div>. redirect: same-tab."),
    },
    handler: guarded(true, async (args) => {
      const productSlug = String(args.productSlug);
      const mode = (args.mode as string | undefined) || 'auto';

      // The widget needs data-store — resolve the key's own store slug.
      const storeEnv = await apiRequest<{ slug: string; name?: string }>('api/v1/store');
      const storeSlug = String(storeEnv.data.slug);

      // Validate the product via the NO-AUTH storefront endpoint (same view the
      // widget itself uses): only active products of non-suspended sellers
      // resolve; everything else (draft/pending/archived/unknown) reads as 404.
      let product: V1ProductLike | null = null;
      try {
        const env = await apiRequest<V1ProductLike>(
          `api/v1/public/stores/${encodeURIComponent(storeSlug)}/products/${encodeURIComponent(productSlug)}`,
          { apiKey: null },
        );
        product = env.data;
      } catch (err) {
        if (err instanceof GetlyApiError && err.status === 404) {
          return refusal(
            `No ACTIVE public product "${productSlug}" in store "${storeSlug}". The Pay Widget only sells active products. ` +
              'List sellable products with list_products (status: active) and use one of their slugs. ' +
              'If the product exists but is a draft, publish it first with publish_product (needs human confirmation).',
          );
        }
        throw err;
      }

      if (!product || typeof product.priceCents !== 'number' || product.priceCents <= 0) {
        return refusal(
          `Product "${productSlug}" is not purchasable through the Pay Widget — it must be a fixed-price product above $0. ` +
            'Free or pay-what-you-want products check out on their product page, not the widget.',
        );
      }

      const snippet = payWidgetSnippet(getBaseUrl(), storeSlug, productSlug, mode);
      const paymentMethods = (product as V1ProductLike & { paymentMethods?: string[] }).paymentMethods;
      return json({
        product: {
          name: product.name,
          slug: product.slug,
          priceCents: product.priceCents,
          url: product.urls?.product,
        },
        ...(paymentMethods ? { paymentMethodsLiveNow: paymentMethods } : {}),
        mode,
        snippet,
        instructions: [
          'Paste the snippet anywhere in the page HTML (the <script> is safe to load once; extra buttons on the same page reuse it).',
          'For a quiz/funnel that picks the product at runtime, render the button with a dynamic data-product and call window.GetlyPay.scan() after inserting it.',
          'Optional attributes: data-success-url="https://…" (where the buyer lands after paying), data-price="show" (append the live price to the button label), data-locale="ru"|"de", and data-i18n-buy / data-i18n-loading / data-i18n-error overrides.',
        ],
        security:
          'The getly:pay:success browser event is an ADVISORY UI signal only — NEVER unlock files, license keys or paid content on it (a visitor can forge it). Getly delivers the product server-side (buyer email + library) once the payment provider confirms payment; verify real sales via the sale.completed / checkout_link.completed webhook.',
        docs: `${getBaseUrl()}/pay-widget`,
      });
    }),
  },
];

// Sanity: the registry is the single source of truth for tool names.
export const TOOL_NAMES = TOOLS.map((t) => t.name);
