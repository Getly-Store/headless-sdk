/**
 * @getly/auto-store — programmatic API.
 *
 * The default export is the pipeline itself; the CLI (`getly-auto-store`)
 * is a thin wrapper around it. All v1 API traffic runs through @getly/sdk.
 */
import { runAutoStore } from './run.js';

export { runAutoStore, MAX_IMAGES, MAX_PRODUCT_FILES, idempotencyBase } from './run.js';
export type { RunOptions, RunDeps, RunResult, RunStatus } from './run.js';
export { scanFolder, kindOf, IMAGE_EXTS, TEXT_EXTS } from './scan.js';
export type { ScanResult, ScannedFile, TextSample } from './scan.js';
export {
  fetchCategories,
  flattenCategories,
  matchCategory,
  fallbackCategory,
  categoryScore,
} from './categories.js';
export type { CategoryNode, FlatCategory } from './categories.js';
export { draftListing, buildDraftPrompt, LISTING_TOOL, DEFAULT_MODEL } from './draft.js';
export type { AnthropicLike } from './draft.js';
export { validateListing, PRODUCT_SLUG_PLACEHOLDER } from './types.js';
export type { DraftedListing, BlogArticleDraft, ListingValidation } from './types.js';

// Re-export the underlying SDK client so programmatic callers construct it
// without a second dependency.
export { Getly, GetlyError, DEFAULT_BASE_URL } from '@getly/sdk';
export type {
  CheckoutLink,
  GetlyOptions,
  Post,
  Product,
  ProductWithModeration,
  PublishBlockedReason,
  Store,
} from '@getly/sdk';

export default runAutoStore;
