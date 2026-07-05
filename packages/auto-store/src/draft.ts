/**
 * Claude drafting step: ONE tool ("draft_listing") with a strict JSON schema
 * and a forced tool_choice — the response arrives as validated tool input,
 * never as fenced JSON that needs regex stripping.
 *
 * Model notes (claude-sonnet-5, the default):
 * - Sampling params (temperature/top_p/top_k) are rejected with a 400 on
 *   this model family — we send none.
 * - `strict: true` guarantees the input validates against the schema
 *   (length limits are NOT expressible in strict schemas, so they live in
 *   the descriptions + validateListing()).
 */
import type { ScanResult } from './scan.js';
import {
  PRODUCT_SLUG_PLACEHOLDER,
  validateListing,
  type DraftedListing,
} from './types.js';

export const DEFAULT_MODEL = 'claude-sonnet-5';

/** Structural subset of the Anthropic SDK client we need (kept loose so
 * tests can inject a fake and the real client can be cast in the CLI). */
export interface AnthropicLike {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      stop_reason: string | null;
      content: Array<{ type: string; name?: string; input?: unknown; text?: string }>;
    }>;
  };
}

export const LISTING_TOOL = {
  name: 'draft_listing',
  description:
    'Submit the finished product listing and companion blog article for the scanned folder. ' +
    'Call this exactly once with the complete draft.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'name',
      'shortDescription',
      'description',
      'tags',
      'suggestedPriceCents',
      'categoryQuery',
      'blogArticle',
    ],
    properties: {
      name: {
        type: 'string',
        description: 'Product name, at most 200 characters. Specific and honest, no clickbait.',
      },
      shortDescription: {
        type: 'string',
        description: 'One-paragraph pitch, at most 500 characters.',
      },
      description: {
        type: 'string',
        description:
          'Full product description in Markdown, 300-600 words. Selling but honest: ' +
          'describe only what the files actually contain, list concrete contents, ' +
          'use headings and bullet lists.',
      },
      tags: {
        type: 'array',
        description: 'Up to 10 lowercase search tags.',
        items: { type: 'string' },
      },
      suggestedPriceCents: {
        type: 'integer',
        description:
          'Suggested price in integer USD cents (e.g. 1900 = $19.00). 0 means free.',
      },
      categoryQuery: {
        type: 'string',
        description:
          'Short free-text category to file the product under, e.g. "icons", ' +
          '"fonts", "notion templates", "3d models". It is fuzzy-matched against ' +
          'the marketplace category tree.',
      },
      blogArticle: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'contentMarkdown', 'excerpt'],
        properties: {
          title: {
            type: 'string',
            description: 'Blog article title (a launch/announcement angle).',
          },
          contentMarkdown: {
            type: 'string',
            description:
              'Blog article in Markdown, 600-1200 words, useful on its own ' +
              '(tips, use cases, how-to) — not a bare ad. It MUST include the ' +
              `literal placeholder ${PRODUCT_SLUG_PLACEHOLDER} exactly once on ` +
              'its own line where the product card should render.',
          },
          excerpt: {
            type: 'string',
            description: 'Article excerpt, at most 500 characters.',
          },
        },
      },
    },
  },
} as const;

export function buildDraftPrompt(scan: ScanResult, priceCentsOverride?: number): string {
  const fileLines = scan.files
    .slice(0, 100)
    .map((f) => `- ${f.relPath} (${f.size} bytes, ${f.ext || 'no ext'}, ${f.kind})`)
    .join('\n');

  const samples = scan.textSamples
    .map((s) => `--- ${s.name} (first 2KB) ---\n${s.snippet}`)
    .join('\n\n');

  const priceNote =
    priceCentsOverride !== undefined
      ? `\nThe seller has fixed the price at ${priceCentsOverride} cents — set suggestedPriceCents to exactly that.`
      : '';

  return [
    `You are drafting a digital-product listing for the Getly marketplace from a local folder scan.`,
    ``,
    `Folder: "${scan.folderName}"`,
    `Files (${scan.files.length} total, ${scan.images.length} images, ${scan.productFiles.length} downloadable):`,
    fileLines,
    samples ? `\nText file samples:\n${samples}` : '',
    ``,
    `Draft the listing and a companion blog article, then submit them via the draft_listing tool.`,
    `Be honest: describe only what these files plausibly contain. Do not invent file counts,`,
    `formats or features that are not evidenced by the scan.${priceNote}`,
  ].join('\n');
}

export async function draftListing(args: {
  scan: ScanResult;
  anthropic: AnthropicLike;
  model?: string;
  priceCentsOverride?: number;
}): Promise<DraftedListing> {
  const { scan, anthropic } = args;
  const model = args.model ?? DEFAULT_MODEL;

  const response = await anthropic.messages.create({
    model,
    max_tokens: 16000,
    tools: [LISTING_TOOL],
    tool_choice: { type: 'tool', name: 'draft_listing' },
    messages: [{ role: 'user', content: buildDraftPrompt(scan, args.priceCentsOverride) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      'Claude declined to draft this listing (safety refusal). Review the folder contents and try again.',
    );
  }

  const toolUse = response.content.find(
    (block) => block.type === 'tool_use' && block.name === LISTING_TOOL.name,
  );
  if (!toolUse) {
    throw new Error(
      `Claude did not return a draft_listing tool call (stop_reason: ${response.stop_reason}).`,
    );
  }

  const validated = validateListing(toolUse.input);
  if (!validated.ok) {
    throw new Error(`Claude's draft failed validation:\n- ${validated.errors.join('\n- ')}`);
  }
  return validated.listing;
}
