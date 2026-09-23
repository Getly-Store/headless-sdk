/**
 * @getly/nextjs — thin Next.js App Router adapters over @getly/sdk.
 *
 * Handlers are plain (req: Request) => Promise<Response> functions — they
 * work as App Router route handlers without importing next at runtime.
 */
export { Checkout } from './checkout.js';
export type { CheckoutOptions } from './checkout.js';
export { Webhooks, WEBHOOK_HANDLER_NAMES } from './webhooks.js';
export type { WebhooksOptions } from './webhooks.js';
export type { GetlyWebhookEvent, TypedGetlyWebhookEvent, WebhookEventName, WebhookPayloadMap } from '@getly/sdk';
