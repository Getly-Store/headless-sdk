/**
 * Category resolution: fetches the public category tree
 * (GET /api/categories — { id, name, slug, parentId, children[] }, 3 levels)
 * and fuzzy-matches Claude's free-text `categoryQuery` against it.
 *
 * The categories endpoint is public and NOT part of the v1 surface, so it is
 * fetched directly here rather than through @getly/sdk.
 */

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  children?: CategoryNode[];
}

/**
 * Fetch the public category tree ({ success: true, data } envelope).
 * No auth header — the endpoint is public and the API key must never
 * travel where it is not required.
 */
export async function fetchCategories(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CategoryNode[]> {
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/categories`);
  let json: { success?: boolean; data?: CategoryNode[] } | null = null;
  try {
    json = (await res.json()) as { success?: boolean; data?: CategoryNode[] };
  } catch {
    json = null;
  }
  if (!res.ok || !json?.success || !Array.isArray(json.data)) {
    throw new Error(`Failed to fetch the category tree (HTTP ${res.status}) from ${baseUrl}/api/categories`);
  }
  return json.data;
}

export interface FlatCategory {
  id: string;
  name: string;
  slug: string;
  depth: number;
  parentName: string | null;
}

export function flattenCategories(tree: CategoryNode[]): FlatCategory[] {
  const out: FlatCategory[] = [];
  const visit = (node: CategoryNode, depth: number, parentName: string | null) => {
    out.push({ id: node.id, name: node.name, slug: node.slug, depth, parentName });
    for (const child of node.children ?? []) visit(child, depth + 1, node.name);
  };
  for (const node of tree) visit(node, 0, null);
  return out;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Deterministic similarity in [0, 1]. Exact > containment > token overlap. */
export function categoryScore(query: string, candidate: FlatCategory): number {
  const q = tokenize(query).join(' ');
  const name = tokenize(candidate.name).join(' ');
  const slug = tokenize(candidate.slug).join(' ');
  if (!q) return 0;
  if (q === name || q === slug) return 1;
  if (name.includes(q) || q.includes(name)) return 0.8;

  const qTokens = new Set(tokenize(query));
  const cTokens = new Set([...tokenize(candidate.name), ...tokenize(candidate.slug)]);
  let common = 0;
  for (const t of qTokens) if (cTokens.has(t)) common++;
  if (common === 0) return 0;
  return (2 * common) / (qTokens.size + cTokens.size);
}

const MATCH_THRESHOLD = 0.34;

/**
 * Best fuzzy match for a category query, or null when nothing clears the
 * threshold. Deeper (more specific) categories win ties.
 */
export function matchCategory(
  query: string,
  flat: FlatCategory[],
): { category: FlatCategory; score: number } | null {
  let best: { category: FlatCategory; score: number } | null = null;
  for (const candidate of flat) {
    const score = categoryScore(query, candidate);
    if (score < MATCH_THRESHOLD) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && candidate.depth > best.category.depth)
    ) {
      best = { category: candidate, score };
    }
  }
  return best;
}

/** Parent categories we prefer as a fallback when the query matches nothing. */
const FALLBACK_PARENT_PREFERENCE = [
  'graphics design',
  'software apps',
  'developer tools',
];

/**
 * Sensible default when fuzzy matching fails: a well-known parent category
 * if present, else the first parent in the tree. The caller MUST tell the
 * user the fallback was used.
 */
export function fallbackCategory(flat: FlatCategory[]): FlatCategory | null {
  const parents = flat.filter((c) => c.depth === 0);
  if (parents.length === 0) return flat[0] ?? null;
  for (const pref of FALLBACK_PARENT_PREFERENCE) {
    const hit = parents.find((p) => tokenize(p.name).join(' ') === pref);
    if (hit) return hit;
  }
  return parents[0];
}
