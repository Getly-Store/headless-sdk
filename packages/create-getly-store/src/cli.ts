#!/usr/bin/env node
/**
 * create-getly-store — npx scaffolder. Zero runtime dependencies.
 *
 *   npx create-getly-store my-store --store my-getly-slug
 */
import path from 'node:path';
import readline from 'node:readline/promises';
import { normalizeSlug, scaffold, ScaffoldError } from './index.js';

const HELP = `create-getly-store — a minimal Next.js storefront for your Getly store.

Usage:
  npx create-getly-store <directory> [--store <store-slug>]

Options:
  --store <slug>   Your Getly store slug (the part after getly.store/store/).
                   Prompted for interactively when omitted.
  --help, -h       Show this help.
`;

interface Args {
  dir?: string;
  store?: string;
  help: boolean;
  errors: string[];
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--store') {
      const value = argv[++i];
      if (!value) args.errors.push('--store requires a value');
      else args.store = value;
    } else if (arg.startsWith('-')) {
      args.errors.push(`Unknown flag: ${arg}`);
    } else if (args.dir) {
      args.errors.push(`Unexpected extra argument: ${arg}`);
    } else {
      args.dir = arg;
    }
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.dir && args.errors.length === 0)) {
    console.log(HELP);
    return args.help ? 0 : 1;
  }
  if (args.errors.length > 0) {
    for (const err of args.errors) console.error(`Error: ${err}`);
    console.error('\nRun with --help for usage.');
    return 1;
  }

  let storeSlug = args.store;
  if (!storeSlug) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(
        'Your Getly store slug (getly.store/store/<slug>): ',
      );
      storeSlug = answer;
    } finally {
      rl.close();
    }
  }
  if (!normalizeSlug(storeSlug ?? '')) {
    console.error('Error: a store slug is required (letters, digits and dashes).');
    console.error('Find yours on your store page URL: https://www.getly.store/dashboard/settings');
    return 1;
  }

  try {
    const result = scaffold({ targetDir: args.dir as string, storeSlug: storeSlug as string });
    const rel = path.relative(process.cwd(), result.targetDir) || '.';
    console.log(`\nScaffolded ${result.filesWritten.length} files into ${rel}/`);
    console.log(`Store slug: ${result.storeSlug} (written to getly.config.json and .env.local.example)`);
    console.log('\nNext steps:');
    console.log(`  cd ${rel}`);
    console.log('  npm install');
    console.log('  npm run dev        # http://localhost:3000');
    console.log('\nDeploy:');
    console.log('  push this folder to a GitHub repo, then import it at https://vercel.com/new');
    console.log('  (details + a Deploy button recipe are in the generated README.md)');
    return 0;
  } catch (err) {
    if (err instanceof ScaffoldError) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
