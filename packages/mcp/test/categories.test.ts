import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { searchCategories, fuzzyScore, _resetCategoryCache } from '../src/categories.js';
import { TOOLS } from '../src/tools.js';

const TREE = {
  success: true,
  data: [
    {
      id: 'p1',
      name: 'Graphics & Design',
      slug: 'graphics-design',
      parentId: null,
      children: [
        { id: 'c1', name: 'Icons', slug: 'icons', parentId: 'p1', children: [] },
        {
          id: 'c2',
          name: 'Illustrations',
          slug: 'illustrations',
          parentId: 'p1',
          children: [{ id: 'g1', name: 'Vector Illustrations', slug: 'vector-illustrations', parentId: 'c2' }],
        },
      ],
    },
    {
      id: 'p2',
      name: '3D & AR/VR',
      slug: '3d-ar-vr',
      parentId: null,
      children: [{ id: 'c3', name: '3D Models', slug: '3d-models', parentId: 'p2', children: [] }],
    },
  ],
};

function stubCategoriesFetch() {
  const fetchSpy = vi.fn(async () =>
    new Response(JSON.stringify(TREE), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  _resetCategoryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('searchCategories', () => {
  it('fuzzy-matches names, ranks exact matches first, includes the path', async () => {
    stubCategoriesFetch();
    const results = await searchCategories('icons');
    expect(results[0]).toMatchObject({
      id: 'c1',
      name: 'Icons',
      slug: 'icons',
      path: 'Graphics & Design > Icons',
    });
  });

  it('matches nested (3rd-level) categories by token', async () => {
    stubCategoriesFetch();
    const results = await searchCategories('vector');
    expect(results.map((r) => r.id)).toContain('g1');
  });

  it('caches the tree in-process (second search does not refetch)', async () => {
    const fetchSpy = stubCategoriesFetch();
    await searchCategories('icons');
    await searchCategories('3d models');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns empty for a nonsense query', async () => {
    stubCategoriesFetch();
    const results = await searchCategories('zzzqqqxxx');
    expect(results).toEqual([]);
  });
});

describe('fuzzyScore ordering', () => {
  const cat = { id: 'x', name: 'Icons', slug: 'icons', path: 'Graphics & Design > Icons' };
  it('exact > prefix > substring > token', () => {
    expect(fuzzyScore('icons', cat)).toBeGreaterThan(fuzzyScore('ico', cat));
    expect(fuzzyScore('ico', cat)).toBeGreaterThan(fuzzyScore('con', cat));
    expect(fuzzyScore('graphics icons', cat)).toBeGreaterThan(0);
  });
});

describe('search_categories tool', () => {
  it('works WITHOUT an API key (public endpoint)', async () => {
    delete process.env.GETLY_API_KEY;
    stubCategoriesFetch();
    const t = TOOLS.find((t) => t.name === 'search_categories')!;
    const result = await t.handler({ query: 'icons' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('"id": "c1"');
  });

  it('suggests broader keywords when nothing matches', async () => {
    stubCategoriesFetch();
    const t = TOOLS.find((t) => t.name === 'search_categories')!;
    const result = await t.handler({ query: 'zzzqqqxxx' });
    expect(result.content[0].text).toContain('No categories matched');
  });
});
