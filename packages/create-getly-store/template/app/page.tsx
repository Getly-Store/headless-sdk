import type { Metadata } from "next";
import Link from "next/link";
import { STORE_SLUG } from "@/lib/config";
import {
  formatPriceCents,
  formatRating,
  getStoreProducts,
} from "@/lib/getly";

/** Re-fetch the catalog at most every 5 minutes (matches the API's cache). */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const data = await getStoreProducts(STORE_SLUG);
  if (!data) return {};
  return {
    title: data.store.name,
    description: `Digital products by ${data.store.name} — powered by Getly.`,
  };
}

export default async function HomePage() {
  const data = await getStoreProducts(STORE_SLUG);

  if (!data) {
    return (
      <main className="container">
        <header className="hero">
          <h1>Store not found</h1>
          <p className="muted">
            No public store answers to the slug &ldquo;{STORE_SLUG}&rdquo;.
            Check <code>getly.config.json</code> (or the{" "}
            <code>NEXT_PUBLIC_GETLY_STORE_SLUG</code> env var) — the slug is
            the part after <code>getly.store/store/</code> on your store page.
          </p>
        </header>
      </main>
    );
  }

  return (
    <main className="container">
      <header className="hero">
        <p className="eyebrow">Digital products</p>
        <h1>{data.store.name}</h1>
        <p className="muted">
          {data.items.length === 0
            ? "No products published yet — new drops land here."
            : `${data.items.length} product${data.items.length === 1 ? "" : "s"} available for instant download.`}
        </p>
      </header>

      {data.items.length > 0 && (
        <ul className="grid">
          {data.items.map((product) => {
            const cover = product.images[0];
            const rating = formatRating(product.avgRating, product.reviewCount);
            return (
              <li key={product.id} className="card">
                <Link href={`/p/${product.slug}`} className="card-media-link">
                  {cover ? (
                    <img
                      className="card-media"
                      src={cover.url}
                      alt={cover.altText ?? product.name}
                      loading="lazy"
                    />
                  ) : (
                    <span className="card-media card-media-empty" aria-hidden>
                      {product.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </Link>
                <div className="card-body">
                  <h2 className="card-title">
                    <Link href={`/p/${product.slug}`}>{product.name}</Link>
                  </h2>
                  {product.shortDescription && (
                    <p className="card-desc">{product.shortDescription}</p>
                  )}
                  <div className="card-footer">
                    <span className="price">
                      {formatPriceCents(product.priceCents, product.currency)}
                    </span>
                    {rating && <span className="rating">{rating}</span>}
                  </div>
                  <a
                    className="button"
                    href={product.urls.buy}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Buy now
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
