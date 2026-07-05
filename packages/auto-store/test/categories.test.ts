import { describe, expect, it } from 'vitest';
import {
  categoryScore,
  fallbackCategory,
  flattenCategories,
  matchCategory,
} from '../src/categories.js';
import { SAMPLE_TREE } from './helpers.js';

const flat = flattenCategories(SAMPLE_TREE);

describe('flattenCategories', () => {
  it('flattens the tree with depth and parent name', () => {
    expect(flat).toHaveLength(5);
    const icons = flat.find((c) => c.id === 'cat-icons');
    expect(icons?.depth).toBe(1);
    expect(icons?.parentName).toBe('Graphics & Design');
  });
});

describe('matchCategory', () => {
  it('matches exact names', () => {
    const match = matchCategory('Developer Tools', flat);
    expect(match?.category.id).toBe('cat-dev');
    expect(match?.score).toBe(1);
  });

  it('matches by containment ("icons" → Icons & UI Elements)', () => {
    const match = matchCategory('icons', flat);
    expect(match?.category.id).toBe('cat-icons');
  });

  it('matches by token overlap', () => {
    const match = matchCategory('ui icons pack', flat);
    expect(match?.category.id).toBe('cat-icons');
  });

  it('prefers deeper (more specific) categories on ties', () => {
    const match = matchCategory('cli tools', flat);
    expect(match?.category.id).toBe('cat-cli');
  });

  it('returns null for nonsense queries', () => {
    expect(matchCategory('quantum blockchain llamas', flat)).toBeNull();
  });

  it('is case/punctuation insensitive', () => {
    expect(categoryScore('GRAPHICS & DESIGN!!!', flat.find((c) => c.id === 'cat-gd')!)).toBe(1);
  });
});

describe('fallbackCategory', () => {
  it('falls back to a preferred parent', () => {
    const fallback = fallbackCategory(flat);
    expect(fallback?.id).toBe('cat-gd'); // "Graphics & Design" is first preference
    expect(fallback?.depth).toBe(0);
  });

  it('returns null for an empty tree', () => {
    expect(fallbackCategory([])).toBeNull();
  });
});
