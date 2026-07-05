import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STORE_SLUG } from "@/lib/config";
import {
  descriptionToParagraphs,
  formatPriceCents,
  formatRating,
  getProduct,
} from "@/lib/getly";

/** Re-fetch the product at most every 5 minutes (matches the API's cache). */
export const revalidate = 300;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(STORE_SLUG, slug);
  if (!product) return {};
  return {
    title: product.name,
    description: product.shortDescription ?? undefined,
    openGraph: product.images[0] ? { images: [product.images[0].url] } : undefined,
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  const product = await getProduct(STORE_SLUG, slug);
  if (!product) notFound();

  const rating = formatRating(product.avgRating, product.reviewCount);
  const paragraphs = descriptionToParagraphs(product.description);

  return (
    <main className="container">
      <nav className="breadcrumb">
        <Link href="/">&larr; All products</Link>
      </nav>

      <article className="product">
        <div className="product-media">
          {product.images.length > 0 ? (
            product.images.map((image, i) => (
              <img
                key={image.url}
                className="product-image"
                src={image.url}
                alt={image.altText ?? product.name}
                loading={i === 0 ? "eager" : "lazy"}
              />
            ))
          ) : (
            <span className="card-media card-media-empty product-image" aria-hidden>
              {product.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>

        <div className="product-info">
          <h1>{product.name}</h1>
          <div className="product-meta">
            <span className="price price-lg">
              {formatPriceCents(product.priceCents, product.currency)}
            </span>
            {rating && <span className="rating">{rating}</span>}
          </div>
          {product.shortDescription && (
            <p className="lead">{product.shortDescription}</p>
          )}
          <a
            className="button button-lg"
            href={product.urls.buy}
            target="_blank"
            rel="noopener noreferrer"
          >
            Buy now — instant download
          </a>
          <p className="muted small">
            Secure checkout on Getly. Files are delivered instantly after
            payment.
          </p>

          {paragraphs.length > 0 && (
            <section className="description">
              <h2>About this product</h2>
              {paragraphs.map((text, i) => (
                <p key={i}>{text}</p>
              ))}
            </section>
          )}
        </div>
      </article>
    </main>
  );
}
