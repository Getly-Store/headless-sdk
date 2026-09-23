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
import {
  verifyWebhookSignature,
  type GetlyWebhookEvent,
  type WebhookEventName,
  type WebhookPayloadMap,
} from '@getly/sdk';

type MaybePromise<T> = T | Promise<T>;

type EventData = Record<string, unknown>;
/** A typed handler: `data` is the exact payload of that event. */
type Handler<K extends WebhookEventName> = (
  data: WebhookPayloadMap[K],
  event: GetlyWebhookEvent<WebhookPayloadMap[K]>,
) => MaybePromise<void>;

export interface WebhooksOptions {
  /**
   * The endpoint's HMAC secret — returned ONCE when the endpoint is created
   * (getly.webhookEndpoints.create). Keep it in an env var.
   */
  secret: string;
  /** Max signature age in seconds. Default 300. */
  toleranceSec?: number;
  /**
   * sale.completed — a buyer paid. Carries buyerEmail (deliver your own
   * license keys there), items[] with orderItemId / isGift, and
   * checkoutLinkId / reference / metadata for checkout-link sales.
   */
  onSaleCompleted?: Handler<'sale.completed'>;
  /** product.created */
  onProductCreated?: Handler<'product.created'>;
  /** product.updated */
  onProductUpdated?: Handler<'product.updated'>;
  /** review.created */
  onReviewCreated?: Handler<'review.created'>;
  /** download.completed — a buyer downloaded a file. */
  onDownloadCompleted?: Handler<'download.completed'>;
  /** refund.created — a buyer asked for a refund; the decision arrives later as order.refunded. */
  onRefundCreated?: Handler<'refund.created'>;
  /** order.refunded — money went back; revoke access on your side. */
  onOrderRefunded?: Handler<'order.refunded'>;
  /** checkout_link.completed */
  onCheckoutLinkCompleted?: Handler<'checkout_link.completed'>;
  /** license.activated */
  onLicenseActivated?: Handler<'license.activated'>;
  /** access.expiring — a timed-access term ends in 7 days (renew reminder went to the buyer). */
  onAccessExpiring?: Handler<'access.expiring'>;
  /** access.expired — a timed-access term has ended; revoke access on your side. */
  onAccessExpired?: Handler<'access.expired'>;
  /** dispute.created */
  onDisputeCreated?: Handler<'dispute.created'>;
  /** dispute.resolved */
  onDisputeResolved?: Handler<'dispute.resolved'>;
  /** billing.subscription.created — a customer subscribed to one of your Getly Billing plans. */
  onBillingSubscriptionCreated?: Handler<'billing.subscription.created'>;
  /** billing.subscription.renewed — a period was paid (paymentId, amountPaidCents). */
  onBillingSubscriptionRenewed?: Handler<'billing.subscription.renewed'>;
  /** billing.payment_failed — a card renewal failed (once per cycle); status is past_due. */
  onBillingPaymentFailed?: Handler<'billing.payment_failed'>;
  /** billing.subscription.canceled — a card subscription ended after cancellation. */
  onBillingSubscriptionCanceled?: Handler<'billing.subscription.canceled'>;
  /** billing.subscription.expired — a PayPal or crypto period ran out unpaid. */
  onBillingSubscriptionExpired?: Handler<'billing.subscription.expired'>;
  /** Called for EVERY verified event (in addition to the typed handler). */
  onEvent?: (event: GetlyWebhookEvent) => MaybePromise<void>;
}

/** Event name → the option that handles it. Covers every subscribable event. */
export const WEBHOOK_HANDLER_NAMES: { readonly [K in WebhookEventName]: keyof WebhooksOptions } = {
  'sale.completed': 'onSaleCompleted',
  'product.created': 'onProductCreated',
  'product.updated': 'onProductUpdated',
  'review.created': 'onReviewCreated',
  'download.completed': 'onDownloadCompleted',
  'refund.created': 'onRefundCreated',
  'order.refunded': 'onOrderRefunded',
  'checkout_link.completed': 'onCheckoutLinkCompleted',
  'license.activated': 'onLicenseActivated',
  'access.expiring': 'onAccessExpiring',
  'access.expired': 'onAccessExpired',
  'dispute.created': 'onDisputeCreated',
  'dispute.resolved': 'onDisputeResolved',
  'billing.subscription.created': 'onBillingSubscriptionCreated',
  'billing.subscription.renewed': 'onBillingSubscriptionRenewed',
  'billing.payment_failed': 'onBillingPaymentFailed',
  'billing.subscription.canceled': 'onBillingSubscriptionCanceled',
  'billing.subscription.expired': 'onBillingSubscriptionExpired',
};

const TYPED_HANDLERS: Record<string, keyof WebhooksOptions> = WEBHOOK_HANDLER_NAMES;

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
        const handler = options[typedKey] as
          | ((data: EventData, event: GetlyWebhookEvent) => MaybePromise<void>)
          | undefined;
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
