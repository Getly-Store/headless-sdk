import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultTemplateDir,
  normalizeSlug,
  scaffold,
  ScaffoldError,
} from '../src/index.js';

const tmpDirs: string[] = [];

async function freshDir(create = false): Promise<string> {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'cgs-test-'));
  tmpDirs.push(base);
  const target = path.join(base, 'my-store');
  if (create) await fsp.mkdir(target);
  return target;
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })),
  );
});

describe('normalizeSlug', () => {
  it('lowercases and strips non-slug characters', () => {
    expect(normalizeSlug('My Store!!')).toBe('my-store');
    expect(normalizeSlug('  Soft_Premium  ')).toBe('soft-premium');
    expect(normalizeSlug('--a--b--')).toBe('a-b');
  });

  it('returns empty string when nothing usable remains', () => {
    expect(normalizeSlug('***')).toBe('');
    expect(normalizeSlug('')).toBe('');
  });
});

describe('scaffold', () => {
  it('copies the full template into a fresh directory', async () => {
    const target = await freshDir();
    const result = scaffold({ targetDir: target, storeSlug: 'demo-shop' });

    expect(result.storeSlug).toBe('demo-shop');
    expect(result.filesWritten.length).toBeGreaterThan(5);

    // Every load-bearing file of the storefront exists.
    for (const rel of [
      'package.json',
      'tsconfig.json',
      'next.config.mjs',
      'vercel.json',
      'getly.config.json',
      'README.md',
      'app/layout.tsx',
      'app/page.tsx',
      'app/globals.css',
      path.join('app', 'p', '[slug]', 'page.tsx'),
      'lib/config.ts',
      'lib/getly.ts',
    ]) {
      expect(fs.existsSync(path.join(target, rel)), `missing ${rel}`).toBe(true);
    }
  });

  it('renames npm-mangled dotfiles on copy', async () => {
    const target = await freshDir();
    scaffold({ targetDir: target, storeSlug: 'demo-shop' });

    expect(fs.existsSync(path.join(target, '.gitignore'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.env.local.example'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'gitignore'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'env.local.example'))).toBe(false);
  });

  it('injects the store slug into config, env example and README', async () => {
    const target = await freshDir();
    scaffold({ targetDir: target, storeSlug: 'Demo Shop' }); // normalized

    const config = JSON.parse(
      fs.readFileSync(path.join(target, 'getly.config.json'), 'utf8'),
    ) as { storeSlug: string };
    expect(config.storeSlug).toBe('demo-shop');

    const env = fs.readFileSync(path.join(target, '.env.local.example'), 'utf8');
    expect(env).toContain('NEXT_PUBLIC_GETLY_STORE_SLUG=demo-shop');

    const readme = fs.readFileSync(path.join(target, 'README.md'), 'utf8');
    expect(readme).toContain('demo-shop');

    // No template token survives anywhere in the output.
    const all = fs.readdirSync(target, { recursive: true }) as string[];
    for (const rel of all) {
      const abs = path.join(target, rel);
      if (!fs.statSync(abs).isFile()) continue;
      const content = fs.readFileSync(abs, 'utf8');
      expect(content, `token left in ${rel}`).not.toContain('__STORE_SLUG__');
      expect(content, `token left in ${rel}`).not.toContain('__APP_NAME__');
    }
  });

  it('writes the app name (target basename) into package.json', async () => {
    const target = await freshDir();
    scaffold({ targetDir: target, storeSlug: 'demo-shop' });
    const pkg = JSON.parse(
      fs.readFileSync(path.join(target, 'package.json'), 'utf8'),
    ) as { name: string; dependencies: Record<string, string> };
    expect(pkg.name).toBe('my-store');
    // The template pins next 15 / react 19.
    expect(pkg.dependencies.next).toMatch(/\^15/);
    expect(pkg.dependencies.react).toMatch(/\^19/);
  });

  it('rejects an unusable slug', async () => {
    const target = await freshDir();
    expect(() => scaffold({ targetDir: target, storeSlug: '###' })).toThrow(ScaffoldError);
    expect(fs.existsSync(target)).toBe(false); // nothing written
  });

  it('refuses to clobber a non-empty directory', async () => {
    const target = await freshDir(true);
    await fsp.writeFile(path.join(target, 'precious.txt'), 'do not touch');

    expect(() => scaffold({ targetDir: target, storeSlug: 'demo-shop' })).toThrow(
      /not empty/,
    );
    // The existing file is untouched and nothing else was written.
    expect(await fsp.readFile(path.join(target, 'precious.txt'), 'utf8')).toBe(
      'do not touch',
    );
    expect((await fsp.readdir(target)).sort()).toEqual(['precious.txt']);
  });

  it('accepts an existing EMPTY directory', async () => {
    const target = await freshDir(true);
    const result = scaffold({ targetDir: target, storeSlug: 'demo-shop' });
    expect(result.filesWritten.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(target, 'app', 'page.tsx'))).toBe(true);
  });

  it('errors when the target exists as a file', async () => {
    const target = await freshDir();
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, 'i am a file');
    expect(() => scaffold({ targetDir: target, storeSlug: 'demo-shop' })).toThrow(
      /not a directory/,
    );
  });

  it('ships a template directory with the package', () => {
    expect(fs.existsSync(defaultTemplateDir())).toBe(true);
  });
});
