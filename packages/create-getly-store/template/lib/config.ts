import config from "../getly.config.json";

/**
 * The Getly store this storefront renders. The env var (set it in
 * .env.local or on Vercel) overrides getly.config.json.
 */
export const STORE_SLUG: string =
  process.env.NEXT_PUBLIC_GETLY_STORE_SLUG || config.storeSlug;

/** Getly API origin. Override with GETLY_API_URL for a different deployment. */
export const GETLY_API_URL: string =
  process.env.GETLY_API_URL || "https://www.getly.store";
