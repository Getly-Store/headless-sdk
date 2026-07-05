/**
 * Checkout() — Next.js App Router GET route-handler factory.
 *
 * Creates a Getly checkout link server-side (your API key never reaches the
 * browser) and 303-redirects the visitor to the hosted checkout.
 *
 *   // app/api/buy/route.ts
 *   import { Checkout } from '@getly/nextjs';
 *   export const GET = Checkout({ productId: 'prod_…' });
 *
 * The returned handler is a plain (req: Request) => Promise<Response> — no
 * runtime import of next.
 */
import { Getly, GetlyError, type CheckoutLinkCreateInput } from '@getly/sdk';

type MaybePromise<T> = T | Promise<T>;

export interface CheckoutOptions {
  /** API key. Defaults to process.env.GETLY_API_KEY (recommended). */
  apiKey?: string;
  /** API origin override (testing). */
  baseUrl?: string;
  /** Custom fetch (testing / instrumentation). */
  fetch?: typeof globalThis.fetch;
  /**
   * The product to sell: a product id, or a function of the incoming request
   * returning a product id OR a full checkout-link create input (per-request
   * coupon/reference/metadata control).
   */
  productId:
    | string
    | ((req: Request) => MaybePromise<string | CheckoutLinkCreateInput>);
  /** Coupon code auto-applied at checkout. */
  coupon?: string;
  /** https URL the buyer lands on after payment. */
  successUrl?: string;
  /** Correlation id echoed into sale.completed webhooks (≤200 chars). */
  reference?: string | ((req: Request) => MaybePromise<string>);
}

/**
 * Build a GET route handler that mints a checkout link and 303-redirects.
 * Checkout-link creation is naturally idempotent per (product, coupon,
 * reference), so repeated visits reuse the same open link.
 */
export function Checkout(options: CheckoutOptions): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      // Instantiate per-request so GETLY_API_KEY is read at request time.
      const getly = new Getly({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        fetch: options.fetch,
      });

      const resolved =
        typeof options.productId === 'function'
          ? await options.productId(req)
          : options.productId;
      const input: CheckoutLinkCreateInput =
        typeof resolved === 'string' ? { productId: resolved } : { ...resolved };

      if (!input.productId) {
        return Response.json(
          { success: false, error: 'Checkout(): productId is required' },
          { status: 500 },
        );
      }
      if (options.coupon && !input.couponCode) input.couponCode = options.coupon;
      if (options.successUrl && !input.successUrl) input.successUrl = options.successUrl;
      if (options.reference && !input.reference) {
        input.reference =
          typeof options.reference === 'function'
            ? await options.reference(req)
            : options.reference;
      }

      const link = await getly.checkoutLinks.create(input);

      return new Response(null, { status: 303, headers: { Location: link.url } });
    } catch (err) {
      // Never leak the API key or internals to the visitor.
      const message =
        err instanceof GetlyError
          ? `Checkout unavailable (${err.code})`
          : 'Checkout unavailable';
      const status = err instanceof GetlyError && err.status === 404 ? 404 : 502;
      return Response.json({ success: false, error: message }, { status });
    }
  };
}
