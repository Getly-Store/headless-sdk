import { describe, expect, it } from 'vitest';
import { LISTING_TOOL } from '../src/draft.js';
import { validateListing, PRODUCT_SLUG_PLACEHOLDER } from '../src/types.js';
import { SAMPLE_LISTING } from './helpers.js';

describe('LISTING_TOOL schema', () => {
  it('is a single strict tool named draft_listing', () => {
    expect(LISTING_TOOL.name).toBe('draft_listing');
    expect(LISTING_TOOL.strict).toBe(true);
  });

  it('forbids extra properties and requires every field (strict-mode contract)', () => {
    const schema = LISTING_TOOL.input_schema;
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(
      [
        'blogArticle',
        'categoryQuery',
        'description',
        'name',
        'shortDescription',
        'suggestedPriceCents',
        'tags',
      ].sort(),
    );
    const blog = schema.properties.blogArticle;
    expect(blog.additionalProperties).toBe(false);
    expect([...blog.required].sort()).toEqual(['contentMarkdown', 'excerpt', 'title'].sort());
  });

  it('does not use string-length keywords unsupported by strict tool use', () => {
    const raw = JSON.stringify(LISTING_TOOL.input_schema);
    expect(raw).not.toContain('maxLength');
    expect(raw).not.toContain('minLength');
  });

  it('documents the product-slug placeholder in the article field', () => {
    expect(LISTING_TOOL.input_schema.properties.blogArticle.properties.contentMarkdown.description).toContain(
      PRODUCT_SLUG_PLACEHOLDER,
    );
  });
});

describe('validateListing', () => {
  it('accepts a valid listing', () => {
    const result = validateListing(SAMPLE_LISTING);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.listing.name).toBe(SAMPLE_LISTING.name);
  });

  it('rejects non-objects', () => {
    expect(validateListing(null).ok).toBe(false);
    expect(validateListing('nope').ok).toBe(false);
  });

  it('rejects a >200 char name', () => {
    const result = validateListing({ ...SAMPLE_LISTING, name: 'x'.repeat(201) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/name.*200/);
  });

  it('rejects a >500 char shortDescription', () => {
    const result = validateListing({ ...SAMPLE_LISTING, shortDescription: 'x'.repeat(501) });
    expect(result.ok).toBe(false);
  });

  it('rejects float or negative prices', () => {
    expect(validateListing({ ...SAMPLE_LISTING, suggestedPriceCents: 9.99 }).ok).toBe(false);
    expect(validateListing({ ...SAMPLE_LISTING, suggestedPriceCents: -1 }).ok).toBe(false);
  });

  it('rejects a missing blogArticle', () => {
    const { blogArticle: _omit, ...rest } = SAMPLE_LISTING;
    const result = validateListing(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('blogArticle');
  });

  it('clamps >10 tags instead of failing', () => {
    const result = validateListing({
      ...SAMPLE_LISTING,
      tags: Array.from({ length: 15 }, (_, i) => `tag${i}`),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.listing.tags).toHaveLength(10);
  });

  it('clamps a >500 char excerpt instead of failing', () => {
    const result = validateListing({
      ...SAMPLE_LISTING,
      blogArticle: { ...SAMPLE_LISTING.blogArticle, excerpt: 'y'.repeat(600) },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.listing.blogArticle.excerpt).toHaveLength(500);
  });
});
