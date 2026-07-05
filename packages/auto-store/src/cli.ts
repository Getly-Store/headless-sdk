#!/usr/bin/env node
/**
 * getly-auto-store — point AI at a folder, get a store.
 *
 * Keys come from the ENVIRONMENT ONLY (GETLY_API_KEY, ANTHROPIC_API_KEY).
 * They are never accepted as CLI arguments and never printed.
 */
import Anthropic from '@anthropic-ai/sdk';
import { Getly, GetlyError } from '@getly/sdk';
import readline from 'node:readline/promises';
import { DEFAULT_MODEL, type AnthropicLike } from './draft.js';
import { runAutoStore, type RunOptions } from './run.js';

const HELP = `getly-auto-store — point AI at a folder, get a Getly store listing.

Usage:
  npx @getly/auto-store <folder> [flags]

Flags:
  --dry-run          Draft the listing and print the plan. Performs NO writes.
  --publish          Publish after upload (default).
  --no-publish       Create everything as a draft; do not publish.
  --price-cents <n>  Override the AI-suggested price (integer cents).
  --model <id>       Claude model id (default: ${DEFAULT_MODEL}).
  --yes, -y          Skip the confirmation prompt.
  --help, -h         Show this help.

Environment:
  GETLY_API_KEY      Getly API key (getly_sk_live_...).
                     Create one: https://www.getly.store/dashboard/developer/keys
  ANTHROPIC_API_KEY  Anthropic API key.
                     Create one: https://platform.claude.com/settings/keys
  GETLY_API_URL      Optional API base URL override (default https://www.getly.store).

Start with a dry run — it costs nothing and writes nothing:
  npx @getly/auto-store ./my-product --dry-run
`;

interface ParsedArgs {
  folder?: string;
  options: Omit<RunOptions, 'folder'>;
  help: boolean;
  errors: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { options: {}, help: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--dry-run':
        parsed.options.dryRun = true;
        break;
      case '--publish':
        parsed.options.publish = true;
        break;
      case '--no-publish':
        parsed.options.publish = false;
        break;
      case '--yes':
      case '-y':
        parsed.options.yes = true;
        break;
      case '--price-cents': {
        const raw = argv[++i];
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) {
          parsed.errors.push('--price-cents requires a non-negative integer (cents)');
        } else {
          parsed.options.priceCents = n;
        }
        break;
      }
      case '--model': {
        const raw = argv[++i];
        if (!raw) parsed.errors.push('--model requires a model id');
        else parsed.options.model = raw;
        break;
      }
      case '--api-key':
      case '--anthropic-key':
      case '--key':
        parsed.errors.push(
          `${arg}: API keys are read from the environment only (GETLY_API_KEY / ANTHROPIC_API_KEY) — never pass them as arguments.`,
        );
        i++; // swallow the would-be value so it is not parsed as a folder
        break;
      default:
        if (arg.startsWith('-')) {
          parsed.errors.push(`Unknown flag: ${arg}`);
        } else if (parsed.folder) {
          parsed.errors.push(`Unexpected extra argument: ${arg}`);
        } else {
          parsed.folder = arg;
        }
    }
  }
  return parsed;
}

function missingEnvMessage(name: 'GETLY_API_KEY' | 'ANTHROPIC_API_KEY'): string {
  if (name === 'GETLY_API_KEY') {
    return [
      'GETLY_API_KEY is not set.',
      '  1. Create an API key (scopes: write:products, write:posts, checkout:create):',
      '     https://www.getly.store/dashboard/developer/keys',
      '  2. export GETLY_API_KEY=getly_sk_live_...',
    ].join('\n');
  }
  return [
    'ANTHROPIC_API_KEY is not set.',
    '  1. Create an Anthropic API key: https://platform.claude.com/settings/keys',
    '  2. export ANTHROPIC_API_KEY=sk-ant-...',
  ].join('\n');
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help || (!parsed.folder && parsed.errors.length === 0)) {
    console.log(HELP);
    return parsed.help ? 0 : 1;
  }
  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) console.error(`Error: ${err}`);
    console.error('\nRun with --help for usage.');
    return 1;
  }

  const getlyKey = process.env.GETLY_API_KEY;
  if (!getlyKey) {
    console.error(missingEnvMessage('GETLY_API_KEY'));
    return 1;
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error(missingEnvMessage('ANTHROPIC_API_KEY'));
    return 1;
  }

  const baseUrl = process.env.GETLY_API_URL;
  const getly = new Getly({ apiKey: getlyKey, baseUrl });
  // Structural cast: the real SDK client satisfies the narrow AnthropicLike
  // surface (messages.create); the cast bridges its stricter param types.
  const anthropic = new Anthropic({ apiKey: anthropicKey }) as unknown as AnthropicLike;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const result = await runAutoStore(
      { folder: parsed.folder as string, ...parsed.options },
      {
        getly,
        anthropic,
        baseUrl,
        log: (line) => console.log(line),
        confirm: async (q) => /^y(es)?$/i.test((await rl.question(q)).trim()),
      },
    );
    return result.status === 'aborted' ? 1 : 0;
  } catch (err) {
    if (err instanceof GetlyError) {
      console.error(`\nGetly API error [${err.code}] (HTTP ${err.status}): ${err.message}`);
      if (err.hint) console.error(`Hint: ${err.hint}`);
      if (err.docsUrl) console.error(`Docs: ${err.docsUrl}`);
    } else {
      console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    }
    return 1;
  } finally {
    rl.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
