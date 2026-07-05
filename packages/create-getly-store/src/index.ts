/**
 * create-getly-store — scaffold logic (zero runtime dependencies, node:fs only).
 *
 * Copies the embedded `template/` directory into the target, injecting the
 * store slug into `getly.config.json` and `.env.local.example`. Files that
 * npm would mangle inside a published package are shipped under safe names
 * and renamed on copy (`gitignore` → `.gitignore`, `env.local.example` →
 * `.env.local.example`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScaffoldError';
  }
}

/** npm publish mangles some dotfiles — ship safe names, rename on copy. */
const RENAMES: Record<string, string> = {
  gitignore: '.gitignore',
  'env.local.example': '.env.local.example',
};

const SLUG_TOKEN = '__STORE_SLUG__';
const APP_NAME_TOKEN = '__APP_NAME__';

export interface ScaffoldOptions {
  targetDir: string;
  storeSlug: string;
  /** Defaults to the template shipped with this package. */
  templateDir?: string;
  /** Defaults to the target directory's basename. */
  appName?: string;
}

export interface ScaffoldResult {
  targetDir: string;
  storeSlug: string;
  appName: string;
  filesWritten: string[];
}

/** Lowercases and strips anything a Getly store slug can't contain. */
export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function defaultTemplateDir(): string {
  // src/index.ts  → ../template ; dist/index.js → ../template (same depth).
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'template');
}

function sanitizeAppName(raw: string): string {
  const name = normalizeSlug(raw);
  return name || 'getly-storefront';
}

function walkTemplate(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? path.join(base, entry.name) : entry.name;
    if (entry.isDirectory()) {
      // Never copy build artifacts if someone ran the template in place.
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      out.push(...walkTemplate(path.join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Scaffold the storefront. Refuses to write into an existing non-empty
 * directory (no-clobber guard) — an existing EMPTY directory is fine.
 */
export function scaffold(opts: ScaffoldOptions): ScaffoldResult {
  const storeSlug = normalizeSlug(opts.storeSlug);
  if (!storeSlug) {
    throw new ScaffoldError(
      `"${opts.storeSlug}" is not a usable store slug (letters, digits and dashes only).`,
    );
  }

  const targetDir = path.resolve(opts.targetDir);
  const templateDir = opts.templateDir ?? defaultTemplateDir();
  if (!fs.existsSync(templateDir)) {
    throw new ScaffoldError(`Template directory not found: ${templateDir}`);
  }

  if (fs.existsSync(targetDir)) {
    const stat = fs.statSync(targetDir);
    if (!stat.isDirectory()) {
      throw new ScaffoldError(`Target exists and is not a directory: ${targetDir}`);
    }
    if (fs.readdirSync(targetDir).length > 0) {
      throw new ScaffoldError(
        `Target directory is not empty: ${targetDir} — refusing to overwrite existing files.`,
      );
    }
  }

  const appName = sanitizeAppName(opts.appName ?? path.basename(targetDir));
  const filesWritten: string[] = [];

  for (const rel of walkTemplate(templateDir)) {
    const parts = rel.split(path.sep);
    const fileName = parts[parts.length - 1];
    const renamed = RENAMES[fileName] ?? fileName;
    const destRel = path.join(...parts.slice(0, -1), renamed);
    const destAbs = path.join(targetDir, destRel);

    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    const content = fs
      .readFileSync(path.join(templateDir, rel), 'utf8')
      .replaceAll(SLUG_TOKEN, storeSlug)
      .replaceAll(APP_NAME_TOKEN, appName);
    fs.writeFileSync(destAbs, content);
    filesWritten.push(destRel);
  }

  return { targetDir, storeSlug, appName, filesWritten };
}
