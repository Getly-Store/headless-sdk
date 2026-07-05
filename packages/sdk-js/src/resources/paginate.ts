import type { Page } from '../types.js';

/**
 * Turn a cursor-paged fetcher into an async iterator:
 *   for await (const p of getly.products.iterate()) { … }
 */
export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const item of page.items) yield item;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}
