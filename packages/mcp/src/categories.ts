/**
 * Category search: fetches the PUBLIC category tree from
 * GET /api/categories (no auth), flattens it (3 levels), fuzzy-filters
 * locally, and caches the tree in-process for 1 hour.
 *
 * Endpoint shape (ground truth: src/app/api/categories/route.ts):
 *   { success: true, data: [{ id, name, slug, parentId, icon?, children: [
 *       { id, name, slug, parentId, children: [...] } ] }] }
 */
import { getBaseUrl, GetlyApiError } from './api.js';

interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  children?: CategoryNode[];
}

export interface FlatCategory {
  id: string;
  name: string;
  slug: string;
  /** Human-readable ancestry, e.g. "Graphics & Design > Icons". */
  path: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cache: { fetchedAt: number; flat: FlatCategory[] } | null = null;

/** Test hook: clear the in-process cache. */
export function _resetCategoryCache(): void {
  cache = null;
}

function flatten(nodes: CategoryNode[], prefix: string, out: FlatCategory[]): void {
  for (const node of nodes) {
    const path = prefix ? `${prefix} > ${node.name}` : node.name;
    out.push({ id: node.id, name: node.name, slug: node.slug, path });
    if (Array.isArray(node.children) && node.children.length > 0) {
      flatten(node.children, path, out);
    }
  }
}

async function loadCategories(): Promise<FlatCategory[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.flat;

  const res = await fetch(`${getBaseUrl()}/api/categories`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: CategoryNode[] }
    | null;
  if (!res.ok || !json?.success || !Array.isArray(json.data)) {
    throw new GetlyApiError(res.status, {
      code: 'api_error',
      message: 'Failed to load the Getly category tree',
      hint: 'Retry in a few seconds; the endpoint is public and cached.',
    });
  }

  const flat: FlatCategory[] = [];
  flatten(json.data, '', flat);
  cache = { fetchedAt: Date.now(), flat };
  return flat;
}

/**
 * Fuzzy score for a category against a query. 0 = no match.
 * Ordering: exact name > name prefix > name substring > all query tokens
 * somewhere in the path > character subsequence of the name.
 */
export function fuzzyScore(query: string, cat: FlatCategory): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = cat.name.toLowerCase();
  const path = cat.path.toLowerCase();
  const slug = cat.slug.toLowerCase();

  if (name === q || slug === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q) || slug.includes(q)) return 60;

  const tokens = q.split(/[\s/,&>-]+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => path.includes(t))) return 40;

  // Character subsequence over the name (e.g. "grph dsgn" ~ "graphics design").
  let i = 0;
  const compact = q.replace(/\s+/g, '');
  for (const ch of name) {
    if (ch === compact[i]) i++;
    if (i === compact.length) return 20;
  }
  return 0;
}

/** Search the category tree. Returns the best `limit` matches, scored. */
export async function searchCategories(
  query: string,
  limit = 10,
): Promise<Array<FlatCategory & { score: number }>> {
  const flat = await loadCategories();
  return flat
    .map((cat) => ({ ...cat, score: fuzzyScore(query, cat) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, Math.min(Math.max(limit, 1), 50));
}
