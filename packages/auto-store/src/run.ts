/**
 * The auto-store pipeline:
 *
 *   scan folder → Claude drafts listing + article → resolve category →
 *   upload images → create draft product (idempotent) → upload files →
 *   publish (moderation-aware, HONEST) → blog post with [product:slug] →
 *   checkout link → print URLs.
 *
 * All v1 API traffic goes through @getly/sdk (Bearer auth, { success, data }
 * envelope, integer-cents money, automatic Idempotency-Key + 429 retries).
 *
 * --dry-run stops after the category step and performs ZERO writes
 * (the only network call is the public GET /api/categories).
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BASE_URL,
  Getly,
  GetlyError,
  type CheckoutLink,
  type ImageContentType,
  type Post,
  type ProductWithModeration,
  type PublishBlockedReason,
} from '@getly/sdk';
import {
  fallbackCategory,
  fetchCategories,
  flattenCategories,
  matchCategory,
  type FlatCategory,
} from './categories.js';
import { draftListing, DEFAULT_MODEL, type AnthropicLike } from './draft.js';
import { scanFolder, type ScannedFile, type ScanResult } from './scan.js';
import type { DraftedListing } from './types.js';

export const MAX_IMAGES = 5;
export const MAX_PRODUCT_FILES = 10;

export interface RunOptions {
  folder: string;
  dryRun?: boolean;
  /** Default true. --no-publish leaves the product as a draft. */
  publish?: boolean;
  /** Skip the interactive confirmation. */
  yes?: boolean;
  model?: string;
  /** Overrides Claude's suggestedPriceCents. Integer cents. */
  priceCents?: number;
}

export interface RunDeps {
  /** Authenticated @getly/sdk client (v1 API). */
  getly: Getly;
  anthropic: AnthropicLike;
  log: (line: string) => void;
  confirm: (question: string) => Promise<boolean>;
  /** API origin — used for the public categories fetch and printed URLs. */
  baseUrl?: string;
  /** fetch used for the PUBLIC categories endpoint (tests inject a fake). */
  fetchImpl?: typeof fetch;
  readFile?: (absPath: string) => Promise<Uint8Array>;
}

export type RunStatus = 'dry-run' | 'live' | 'awaiting-review' | 'draft' | 'aborted';

export interface RunResult {
  status: RunStatus;
  scan: ScanResult;
  listing: DraftedListing;
  category: FlatCategory | null;
  categoryFellBack: boolean;
  product?: ProductWithModeration;
  post?: Post;
  checkoutLink?: CheckoutLink;
  moderationNote?: string;
  publishBlockers?: PublishBlockedReason[];
}

const IMAGE_MIME: Record<string, ImageContentType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

const FILE_MIME: Record<string, string> = {
  zip: 'application/zip',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
};

function fileMime(ext: string): string {
  return IMAGE_MIME[ext] ?? FILE_MIME[ext] ?? 'application/octet-stream';
}

/** Deterministic per-folder idempotency key base: re-running the CLI on the
 * same folder replays the same create instead of minting duplicates. */
export function idempotencyBase(folderPath: string, listingName: string): string {
  return createHash('sha256')
    .update(`${path.resolve(folderPath)}|${listingName}`)
    .digest('hex')
    .slice(0, 40);
}

function embedProductSlug(contentMarkdown: string, slug: string): string {
  const pattern = /\[product:[^\]\n]*\]/g;
  if (pattern.test(contentMarkdown)) {
    return contentMarkdown.replace(pattern, `[product:${slug}]`);
  }
  return `${contentMarkdown.trimEnd()}\n\n[product:${slug}]\n`;
}

function summarizeListing(listing: DraftedListing, log: (l: string) => void): void {
  log('');
  log(`  Name:        ${listing.name}`);
  log(`  Price:       $${(listing.suggestedPriceCents / 100).toFixed(2)} (${listing.suggestedPriceCents} cents)`);
  log(`  Tags:        ${listing.tags.join(', ') || '(none)'}`);
  log(`  Category:    ${listing.categoryQuery}`);
  log(`  Short desc:  ${listing.shortDescription}`);
  log('');
  log('  Description:');
  for (const line of listing.description.split('\n')) log(`    ${line}`);
  log('');
  log(`  Blog article: "${listing.blogArticle.title}"`);
  log(`  Excerpt:      ${listing.blogArticle.excerpt}`);
  log('');
}

async function uploadImages(
  getly: Getly,
  images: ScannedFile[],
  readFile: (p: string) => Promise<Uint8Array>,
  log: (l: string) => void,
): Promise<Array<{ url: string; altText?: string }>> {
  const selected = images.slice(0, MAX_IMAGES);
  if (images.length > MAX_IMAGES) {
    log(`  Note: ${images.length} images found — uploading the first ${MAX_IMAGES}.`);
  }
  const uploaded: Array<{ url: string; altText?: string }> = [];
  for (const img of selected) {
    const contentType = IMAGE_MIME[img.ext];
    if (!contentType) continue;
    const bytes = await readFile(img.absPath);
    const { publicUrl } = await getly.uploads.uploadImage({
      data: bytes,
      contentType,
      fileName: img.name,
    });
    uploaded.push({ url: publicUrl, altText: img.name });
    log(`  ↑ image ${img.relPath}`);
  }
  return uploaded;
}

async function uploadProductFiles(
  getly: Getly,
  productId: string,
  productFiles: ScannedFile[],
  readFile: (p: string) => Promise<Uint8Array>,
  log: (l: string) => void,
): Promise<number> {
  const selected = productFiles.slice(0, MAX_PRODUCT_FILES);
  if (productFiles.length > 1) {
    log(
      `  Note: ${productFiles.length} non-image files — each is uploaded as its own ` +
        `downloadable file (no zipping${productFiles.length > MAX_PRODUCT_FILES ? `; capped at ${MAX_PRODUCT_FILES}` : ''}). ` +
        'Zip the folder yourself first if you want a single download.',
    );
  }
  let attached = 0;
  for (const file of selected) {
    const bytes = await readFile(file.absPath);
    await getly.products.uploadFile(productId, {
      fileName: file.name,
      data: bytes,
      fileType: fileMime(file.ext),
    });
    attached++;
    log(`  ↑ file ${file.relPath}`);
  }
  return attached;
}

export async function runAutoStore(opts: RunOptions, deps: RunDeps): Promise<RunResult> {
  const { getly, anthropic, log, confirm } = deps;
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = deps.fetchImpl ?? fetch;
  const readFile = deps.readFile ?? (async (p: string) => new Uint8Array(await fs.readFile(p)));
  const dryRun = opts.dryRun ?? false;
  const publish = opts.publish ?? true;
  const model = opts.model ?? DEFAULT_MODEL;

  // 1. Scan ------------------------------------------------------------------
  log(`Scanning ${opts.folder} ...`);
  const scan = await scanFolder(opts.folder);
  log(
    `Found ${scan.files.length} files (${scan.images.length} images, ` +
      `${scan.productFiles.length} downloadable).`,
  );
  if (scan.productFiles.length === 0) {
    log('Warning: no non-image files found — the product cannot be published without a downloadable file.');
  }

  // 2. Draft with Claude -----------------------------------------------------
  log(`Drafting listing with ${model} ...`);
  const listing = await draftListing({
    scan,
    anthropic,
    model,
    priceCentsOverride: opts.priceCents,
  });
  if (opts.priceCents !== undefined) listing.suggestedPriceCents = opts.priceCents;

  // 3. Resolve category (public read — allowed in dry-run) --------------------
  const tree = await fetchCategories(baseUrl, fetchImpl);
  const flat = flattenCategories(tree);
  const match = matchCategory(listing.categoryQuery, flat);
  let category = match?.category ?? null;
  let categoryFellBack = false;
  if (!category) {
    category = fallbackCategory(flat);
    categoryFellBack = category !== null;
    if (category) {
      log(
        `Category: no match for "${listing.categoryQuery}" — falling back to the ` +
          `"${category.name}" parent category. Adjust it later in the dashboard if needed.`,
      );
    } else {
      log(`Category: no match for "${listing.categoryQuery}" and no fallback available — creating without a category.`);
    }
  } else {
    log(`Category: "${listing.categoryQuery}" → ${category.name} (${category.slug})`);
  }

  summarizeListing(listing, log);

  // 4. Dry run stops here — ZERO writes. --------------------------------------
  if (dryRun) {
    log('Plan (dry run — nothing was created):');
    log(`  1. Upload ${Math.min(scan.images.length, MAX_IMAGES)} image(s)`);
    log(`  2. Create draft product "${listing.name}" (${listing.suggestedPriceCents} cents)`);
    log(`  3. Upload ${Math.min(scan.productFiles.length, MAX_PRODUCT_FILES)} downloadable file(s)`);
    log(`  4. ${publish ? 'Publish the product (moderation may apply)' : 'Leave as draft (--no-publish)'}`);
    log('  5. Publish a blog post embedding the product');
    log('  6. Create a checkout link');
    log('');
    log('Re-run without --dry-run to execute.');
    return { status: 'dry-run', scan, listing, category, categoryFellBack };
  }

  // 5. Confirm ----------------------------------------------------------------
  if (!opts.yes) {
    const go = await confirm(`Create "${listing.name}" on ${baseUrl}? [y/N] `);
    if (!go) {
      log('Aborted. Nothing was created.');
      return { status: 'aborted', scan, listing, category, categoryFellBack };
    }
  }

  // 6. Upload images -----------------------------------------------------------
  const images = await uploadImages(getly, scan.images, readFile, log);

  // 7. Create draft product (idempotent on folder+name) ------------------------
  const base = idempotencyBase(scan.folderPath, listing.name);
  const product = await getly.products.create(
    {
      name: listing.name,
      description: listing.description,
      shortDescription: listing.shortDescription,
      priceCents: listing.suggestedPriceCents,
      ...(category ? { categoryId: category.id } : {}),
      tags: listing.tags,
      status: 'draft',
      ...(images.length > 0 ? { images } : {}),
    },
    { idempotencyKey: `autostore-product-${base}` },
  );
  log(`Created draft product: ${product.name ?? listing.name} (${product.id})`);

  // 8. Upload downloadable files ------------------------------------------------
  const attached = await uploadProductFiles(getly, product.id, scan.productFiles, readFile, log);
  if (attached === 0) {
    log('Warning: no downloadable files were attached — publish will be blocked until one exists.');
  }

  // 9. Publish (honest about moderation) ----------------------------------------
  let status: RunStatus = 'draft';
  let moderationNote: string | undefined;
  let publishBlockers: PublishBlockedReason[] | undefined;
  let finalProduct = product;

  if (publish) {
    let published: ProductWithModeration | null = null;
    try {
      published = await getly.products.publish(product.id, {
        idempotencyKey: `autostore-publish-${base}`,
      });
    } catch (err) {
      // 422 not_publishable is a NORMAL outcome (missing file, moderation
      // lock) — report every machine-readable blocker honestly.
      if (err instanceof GetlyError && err.code === 'not_publishable') {
        publishBlockers = err.reasons ?? [];
        log('✗ Publish blocked — the product stays a draft. Reasons:');
        for (const reason of publishBlockers) {
          log(`   - [${reason.code}] ${reason.detail}`);
        }
      } else {
        throw err;
      }
    }
    if (published) {
      finalProduct = { ...product, ...published };
      if (published.status === 'active') {
        status = 'live';
        log(`✔ Product is LIVE: ${finalProduct.urls?.product ?? product.urls.product}`);
      } else if (published.moderationStatus === 'pending_review' || published.status === 'pending_review') {
        status = 'awaiting-review';
        moderationNote = published.note;
        log('⏳ Product submitted — awaiting review. It is NOT live yet.');
        if (moderationNote) log(`   Reviewer note: ${moderationNote}`);
        log('   You will be able to see the status in your dashboard: https://www.getly.store/dashboard/products');
      } else {
        status = 'draft';
        log(`Product status after publish: ${published.status} (not live).`);
      }
    }
  } else {
    log('Skipping publish (--no-publish): the product stays a draft.');
  }

  // 10. Blog post ----------------------------------------------------------------
  let post: Post | undefined;
  let postUrl: string | undefined;
  try {
    const contentMarkdown = embedProductSlug(listing.blogArticle.contentMarkdown, finalProduct.slug);
    post = await getly.posts.create(
      {
        title: listing.blogArticle.title,
        contentMarkdown,
        excerpt: listing.blogArticle.excerpt || undefined,
        status: 'published',
      },
      { idempotencyKey: `autostore-post-${base}` },
    );
    try {
      const store = await getly.store.get();
      postUrl = `${baseUrl}/store/${store.slug}/posts/${post.slug}`;
    } catch {
      postUrl = undefined;
    }
    log(`✔ Blog post published: ${postUrl ?? `(slug: ${post.slug})`}`);
  } catch (err) {
    log(`Blog post skipped: ${err instanceof GetlyError ? `[${err.code}] ${err.message}` : String(err)}`);
  }

  // 11. Checkout link — only makes sense for a LIVE product ----------------------
  let checkoutLink: CheckoutLink | undefined;
  if (status === 'live') {
    try {
      checkoutLink = await getly.checkoutLinks.create(
        { productId: finalProduct.id, reference: 'auto-store' },
        { idempotencyKey: `autostore-link-${base}` },
      );
      log(`✔ Checkout link: ${checkoutLink.url}`);
    } catch (err) {
      log(
        `Checkout link skipped: ${err instanceof GetlyError ? `[${err.code}] ${err.message}` : String(err)}`,
      );
    }
  } else {
    log('Checkout link skipped: the product is not live yet (links require an active product).');
  }

  // 12. Summary -------------------------------------------------------------------
  log('');
  log('Summary');
  log(`  Product:  ${finalProduct.urls?.product ?? '(draft — see dashboard)'} [${status}]`);
  if (postUrl) log(`  Post:     ${postUrl}`);
  if (checkoutLink) log(`  Buy link: ${checkoutLink.url}`);

  return {
    status,
    scan,
    listing,
    category,
    categoryFellBack,
    product: finalProduct,
    post,
    checkoutLink,
    moderationNote,
    publishBlockers,
  };
}
