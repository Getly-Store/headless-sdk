import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanFolder, kindOf } from '../src/scan.js';
import { makeFixtureFolder, rmrf } from './helpers.js';

let dir: string;

beforeAll(async () => {
  dir = await makeFixtureFolder();
});

afterAll(async () => {
  await rmrf(dir);
});

describe('scanFolder', () => {
  it('classifies images, text files and product files', async () => {
    const scan = await scanFolder(dir);
    const names = scan.files.map((f) => f.relPath).sort();
    expect(names).toContain('README.md');
    expect(names).toContain('preview.png');
    expect(names.some((n) => n.endsWith('pack.zip'))).toBe(true);

    expect(scan.images.map((f) => f.name)).toEqual(['preview.png']);
    // Non-image files become downloadable product files (README, zip, license).
    expect(scan.productFiles.map((f) => f.name).sort()).toEqual([
      'LICENSE.txt',
      'README.md',
      'pack.zip',
    ]);
  });

  it('ignores dotfiles and node_modules', async () => {
    const scan = await scanFolder(dir);
    expect(scan.files.some((f) => f.name === '.hidden')).toBe(false);
    expect(scan.files.some((f) => f.relPath.includes('node_modules'))).toBe(false);
  });

  it('reads text samples (README first, <= 2KB)', async () => {
    const scan = await scanFolder(dir);
    expect(scan.textSamples.length).toBeGreaterThan(0);
    expect(scan.textSamples.length).toBeLessThanOrEqual(3);
    expect(scan.textSamples[0].name).toBe('README.md');
    expect(scan.textSamples[0].snippet).toContain('Minimal Icon Pack');
    for (const sample of scan.textSamples) {
      expect(Buffer.byteLength(sample.snippet, 'utf8')).toBeLessThanOrEqual(2048);
    }
  });

  it('records sizes and extensions', async () => {
    const scan = await scanFolder(dir);
    const readme = scan.files.find((f) => f.name === 'README.md');
    expect(readme?.ext).toBe('md');
    expect(readme?.size).toBeGreaterThan(0);
  });

  it('throws on a non-directory', async () => {
    await expect(scanFolder(`${dir}/does-not-exist`)).rejects.toThrow(/Not a directory/);
  });
});

describe('kindOf', () => {
  it('maps extensions to kinds', () => {
    expect(kindOf('a.png')).toBe('image');
    expect(kindOf('a.JPG'.toLowerCase())).toBe('image');
    expect(kindOf('a.md')).toBe('text');
    expect(kindOf('a.zip')).toBe('file');
    expect(kindOf('noext')).toBe('file');
  });
});
