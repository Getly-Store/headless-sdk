/**
 * Shared types for @getly/auto-store.
 *
 * Money convention (Getly API spec A7): ALL amounts are integer cents
 * (`priceCents`). Never dollars, never floats.
 */

/** The exact placeholder the model must embed in the blog article. It is
 * replaced with the real product slug after the product is created. */
export const PRODUCT_SLUG_PLACEHOLDER = '[product:PRODUCT_SLUG]';

export interface BlogArticleDraft {
  title: string;
  /** Markdown, 600-1200 words, must contain the [product:PRODUCT_SLUG] embed. */
  contentMarkdown: string;
  /** <= 500 chars. */
  excerpt: string;
}

export interface DraftedListing {
  /** <= 200 chars. */
  name: string;
  /** <= 500 chars. */
  shortDescription: string;
  /** Markdown, selling but honest, 300-600 words. */
  description: string;
  /** <= 10 tags. */
  tags: string[];
  /** Integer cents, >= 0. */
  suggestedPriceCents: number;
  /** Free-text category query resolved against /api/categories. */
  categoryQuery: string;
  blogArticle: BlogArticleDraft;
}

export type ListingValidation =
  | { ok: true; listing: DraftedListing }
  | { ok: false; errors: string[] };

/**
 * Validate (and lightly normalize) the tool output from Claude.
 * Hard requirements error; soft overflows (too many tags, long excerpt)
 * are clamped so a near-miss draft doesn't kill the run.
 */
export function validateListing(input: unknown): ListingValidation {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['tool output is not an object'] };
  }
  const o = input as Record<string, unknown>;

  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) errors.push('name is required');
  if (name.length > 200) errors.push('name must be at most 200 characters');

  const shortDescription =
    typeof o.shortDescription === 'string' ? o.shortDescription.trim() : '';
  if (!shortDescription) errors.push('shortDescription is required');
  if (shortDescription.length > 500) {
    errors.push('shortDescription must be at most 500 characters');
  }

  const description = typeof o.description === 'string' ? o.description.trim() : '';
  if (!description) errors.push('description is required');

  let tags: string[] = [];
  if (Array.isArray(o.tags)) {
    tags = o.tags
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 50))
      .slice(0, 10); // clamp, don't fail
  }

  const suggestedPriceCents = o.suggestedPriceCents;
  if (
    typeof suggestedPriceCents !== 'number' ||
    !Number.isInteger(suggestedPriceCents) ||
    suggestedPriceCents < 0
  ) {
    errors.push('suggestedPriceCents must be a non-negative integer (cents)');
  }

  const categoryQuery =
    typeof o.categoryQuery === 'string' ? o.categoryQuery.trim() : '';
  if (!categoryQuery) errors.push('categoryQuery is required');

  const blog = o.blogArticle as Record<string, unknown> | undefined;
  let blogArticle: BlogArticleDraft | null = null;
  if (typeof blog !== 'object' || blog === null) {
    errors.push('blogArticle is required');
  } else {
    const title = typeof blog.title === 'string' ? blog.title.trim() : '';
    const contentMarkdown =
      typeof blog.contentMarkdown === 'string' ? blog.contentMarkdown : '';
    let excerpt = typeof blog.excerpt === 'string' ? blog.excerpt.trim() : '';
    if (!title) errors.push('blogArticle.title is required');
    if (!contentMarkdown.trim()) errors.push('blogArticle.contentMarkdown is required');
    if (excerpt.length > 500) excerpt = excerpt.slice(0, 500); // clamp
    blogArticle = { title, contentMarkdown, excerpt };
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    listing: {
      name,
      shortDescription,
      description,
      tags,
      suggestedPriceCents: suggestedPriceCents as number,
      categoryQuery,
      blogArticle: blogArticle as BlogArticleDraft,
    },
  };
}
