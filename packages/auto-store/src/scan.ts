/**
 * Folder scanner: builds the context Claude drafts a listing from.
 * Reads file names / sizes / extensions, plus the first 2KB of up to
 * three text-ish files. Detects images (uploaded as product gallery)
 * vs everything else (uploaded as downloadable product files).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);
export const TEXT_EXTS = new Set([
  'md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv',
  'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
]);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '__pycache__']);
const MAX_FILES = 500;
const MAX_DEPTH = 4;
const SNIPPET_BYTES = 2048;
const MAX_TEXT_SAMPLES = 3;

export type FileKind = 'image' | 'text' | 'file';

export interface ScannedFile {
  name: string;
  relPath: string;
  absPath: string;
  size: number;
  ext: string;
  kind: FileKind;
}

export interface TextSample {
  name: string;
  snippet: string;
}

export interface ScanResult {
  folderPath: string;
  folderName: string;
  files: ScannedFile[];
  /** Gallery candidates (first 5 get uploaded). */
  images: ScannedFile[];
  /** Everything non-image — these become downloadable files. */
  productFiles: ScannedFile[];
  textSamples: TextSample[];
}

function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return '';
  return name.slice(idx + 1).toLowerCase();
}

export function kindOf(name: string): FileKind {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (TEXT_EXTS.has(ext)) return 'text';
  return 'file';
}

async function walk(
  dir: string,
  root: string,
  depth: number,
  out: ScannedFile[],
): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(abs, root, depth + 1, out);
    } else if (entry.isFile()) {
      const stat = await fs.stat(abs);
      out.push({
        name: entry.name,
        relPath: path.relative(root, abs),
        absPath: abs,
        size: stat.size,
        ext: extOf(entry.name),
        kind: kindOf(entry.name),
      });
    }
  }
}

async function readSnippet(absPath: string): Promise<string> {
  const handle = await fs.open(absPath, 'r');
  try {
    const buf = Buffer.alloc(SNIPPET_BYTES);
    const { bytesRead } = await handle.read(buf, 0, SNIPPET_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function scanFolder(folderPath: string): Promise<ScanResult> {
  const abs = path.resolve(folderPath);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }

  const files: ScannedFile[] = [];
  await walk(abs, abs, 0, files);
  if (files.length === 0) {
    throw new Error(`Folder is empty: ${abs} — nothing to sell.`);
  }

  const images = files.filter((f) => f.kind === 'image');
  const productFiles = files.filter((f) => f.kind !== 'image');

  const textCandidates = files
    .filter((f) => f.kind === 'text' && f.size > 0)
    // READMEs first — they describe the product best.
    .sort((a, b) => {
      const aReadme = /^readme/i.test(a.name) ? 0 : 1;
      const bReadme = /^readme/i.test(b.name) ? 0 : 1;
      if (aReadme !== bReadme) return aReadme - bReadme;
      return b.size - a.size;
    })
    .slice(0, MAX_TEXT_SAMPLES);

  const textSamples: TextSample[] = [];
  for (const file of textCandidates) {
    textSamples.push({ name: file.relPath, snippet: await readSnippet(file.absPath) });
  }

  return {
    folderPath: abs,
    folderName: path.basename(abs),
    files,
    images,
    productFiles,
    textSamples,
  };
}
