/**
 * Webhooks() — Next.js App Router POST route-handler factory.
 *
 * Reads the RAW request body, verifies the timestamped X-Getly-Signature-V2
 * header via @getly/sdk's verifyWebhookSignature (timing-safe, 300s replay
 * tolerance), 401s bad signatures, and dispatches typed event handlers.
 *
 *   // app/api/webhooks/getly/route.ts
 *   import { Webhooks } from '@getly/nextjs';
 *   export const POST = Webhooks({
 *     secret: process.env.GETLY_WEBHOOK_SECRET!,
 *     onSaleCompleted: async (data) => { … },
 *   });
 */
import { verifyWebhookSignature, type GetlyWebhookEvent } from '@getly/sdk';

type MaybePromise<T> = T | Promise<T>;

type EventData = Record<string, unknown>;
type EventHandler = (data: EventData, event: GetlyWebhookEvent) => MaybePromise<void>;

export interface WebhooksOptions {
  /**
   * The endpoint's HMAC secret — returned ONCE when the endpoint is created
   * (getly.webhookEndpoints.create). Keep it in an env var.
   */
  secret: string;
  /** Max signature age in seconds. Default 300. */
  toleranceSec?: number;
  /** sale.completed — a buyer paid (carries checkoutLinkId/reference/metadata for link sales). */
  onSaleCompleted?: EventHandler;
  /** order.refunded */
  onOrderRefunded?: EventHandler;
  /** checkout_link.completed */
  onCheckoutLinkCompleted?: EventHandler;
  /** license.activated */
  onLicenseActivated?: EventHandler;
  /** Called for EVERY verified event (in addition to the typed handler). */
  onEvent?: (event: GetlyWebhookEvent) => MaybePromise<void>;
}

const TYPED_HANDLERS: Record<string, keyof WebhooksOptions> = {
  'sale.completed': 'onSaleCompleted',
  'order.refunded': 'onOrderRefunded',
  'checkout_link.completed': 'onCheckoutLinkCompleted',
  'license.activated': 'onLicenseActivated',
};

/**
 * Build a POST route handler. Responses:
 * - 401 invalid/missing signature (never dispatches);
 * - 400 unparseable body;
 * - 500 when YOUR handler throws (Getly retries the delivery);
 * - 200 for every verified event, handled or not.
 */
export function Webhooks(options: WebhooksOptions): (req: Request) => Promise<Response> {
  if (!options.secret) {
    throw new Error(
      'Webhooks(): secret is required — it was returned once when you created the webhook endpoint. Store it in an env var (e.g. GETLY_WEBHOOK_SECRET).',
    );
  }

  return async (req: Request): Promise<Response> => {
    // The signature covers the EXACT raw body — read text, never re-serialize.
    const payload = await req.text();
    const header = req.headers.get('x-getly-signature-v2');

    const valid = verifyWebhookSignature({
      payload,
      header,
      secret: options.secret,
      toleranceSec: options.toleranceSec,
    });
    if (!valid) {
      return Response.json({ received: false, error: 'Invalid signature' }, { status: 401 });
    }

    let event: GetlyWebhookEvent;
    try {
      const parsed = JSON.parse(payload) as Partial<GetlyWebhookEvent>;
      if (!parsed || typeof parsed.event !== 'string') throw new Error('missing event');
      event = {
        deliveryId: parsed.deliveryId,
        event: parsed.event,
        data: (parsed.data ?? {}) as EventData,
        timestamp: parsed.timestamp,
      };
    } catch {
      return Response.json({ received: false, error: 'Invalid payload' }, { status: 400 });
    }

    try {
      const typedKey = TYPED_HANDLERS[event.event];
      if (typedKey) {
        const handler = options[typedKey] as EventHandler | undefined;
        if (handler) await handler(event.data as EventData, event);
      }
      if (options.onEvent) await options.onEvent(event);
    } catch (err) {
      // A throwing handler → 500 so Getly's delivery retry kicks in.
      console.error(`@getly/nextjs Webhooks: handler for "${event.event}" threw:`, err);
      return Response.json({ received: false, error: 'Handler error' }, { status: 500 });
    }

    return Response.json({ received: true });
  };
}
