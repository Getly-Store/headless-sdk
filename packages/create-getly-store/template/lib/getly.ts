/**
 * Typed helpers for Getly's PUBLIC storefront API (no auth, CORS *):
 *
 *   GET /api/v1/public/stores/{slug}/products
 *   GET /api/v1/public/stores/{slug}/products/{productSlug}
 *
 * Responses use the { success, data } envelope; every price is INTEGER CENTS
 * (`priceCents`). Pages fetch server-side with `revalidate: 300` — the same
 * s-maxage the API itself serves.
 */
import { GETLY_API_URL } from "./config";

export interface PublicProductImage {
  url: string;
  altText: string | null;
}

export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  /** Present only on the single-product endpoint. */
  description?: string | null;
  /** Integer cents — the only money field this template reads. */
  priceCents: number;
  currency: string;
  avgRating: number;
  reviewCount: number;
  images: PublicProductImage[];
  urls: {
    product: string;
    buy: string;
  };
}

export interface StoreProducts {
  store: { id: string; name: string; slug: string };
  items: PublicProduct[];
  nextCursor: string | null;
}

const REVALIDATE_SECONDS = 300;

export async function getStoreProducts(
  storeSlug: string,
): Promise<StoreProducts | null> {
  try {
    const res = await fetch(
      `${GETLY_API_URL}/api/v1/public/stores/${encodeURIComponent(storeSlug)}/products?limit=48`,
      { next: { revalidate: REVALIDATE_SECONDS } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: StoreProducts };
    return json.success && json.data ? json.data : null;
  } catch {
    return null;
  }
}

export async function getProduct(
  storeSlug: string,
  productSlug: string,
): Promise<PublicProduct | null> {
  try {
    const res = await fetch(
      `${GETLY_API_URL}/api/v1/public/stores/${encodeURIComponent(storeSlug)}/products/${encodeURIComponent(productSlug)}`,
      { next: { revalidate: REVALIDATE_SECONDS } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { success?: boolean; data?: PublicProduct };
    return json.success && json.data ? json.data : null;
  } catch {
    return null;
  }
}

export function formatPriceCents(priceCents: number, currency = "USD"): string {
  if (priceCents === 0) return "Free";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(priceCents / 100);
}

export function formatRating(avgRating: number, reviewCount: number): string | null {
  if (reviewCount === 0) return null;
  return `★ ${avgRating.toFixed(1)} · ${reviewCount} review${reviewCount === 1 ? "" : "s"}`;
}

/**
 * Product descriptions may contain rich-text HTML (sellers write them in the
 * Getly dashboard editor). This template deliberately does NOT inject that
 * HTML (no dangerouslySetInnerHTML) — it strips tags and renders plain
 * paragraphs instead. Safe by construction.
 */
export function descriptionToParagraphs(
  description: string | null | undefined,
): string[] {
  if (!description) return [];
  const text = description
    // Block-level closers become paragraph breaks before tags are stripped.
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, "\n\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"');
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
