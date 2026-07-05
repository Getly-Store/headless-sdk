import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Getly } from '@getly/sdk';
import { runAutoStore } from '../src/run.js';
import {
  fakeAnthropic,
  fakeFetch,
  makeFixtureFolder,
  rmrf,
  SAMPLE_TREE,
} from './helpers.js';

let dir: string;

beforeAll(async () => {
  dir = await makeFixtureFolder();
});

afterAll(async () => {
  await rmrf(dir);
});

describe('runAutoStore --dry-run', () => {
  it('drafts, resolves the category, prints the plan and performs ZERO writes', async () => {
    const { impl, calls } = fakeFetch({
      'GET /api/categories': { json: { success: true, data: SAMPLE_TREE } },
    });
    const getly = new Getly({ apiKey: 'getly_sk_live_test', fetch: impl });
    const lines: string[] = [];

    const result = await runAutoStore(
      { folder: dir, dryRun: true },
      {
        getly,
        fetchImpl: impl,
        anthropic: fakeAnthropic(),
        log: (l) => lines.push(l),
        confirm: async () => {
          throw new Error('confirm must not be called in dry-run');
        },
      },
    );

    expect(result.status).toBe('dry-run');
    expect(result.listing.name).toBe('Minimal Icon Pack');
    expect(result.category?.id).toBe('cat-icons');
    expect(result.categoryFellBack).toBe(false);

    // THE dry-run contract: no write verbs, no write endpoints, at all.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.method).toBe('GET');
      expect(call.url).toContain('/api/categories');
    }

    const output = lines.join('\n');
    expect(output).toContain('Minimal Icon Pack');
    expect(output).toContain('dry run — nothing was created');
    expect(output).toContain('$9.00');
  });

  it('falls back to a parent category and says so', async () => {
    const { impl } = fakeFetch({
      'GET /api/categories': { json: { success: true, data: SAMPLE_TREE } },
    });
    const getly = new Getly({ apiKey: 'getly_sk_live_test', fetch: impl });
    const lines: string[] = [];

    const result = await runAutoStore(
      { folder: dir, dryRun: true },
      {
        getly,
        fetchImpl: impl,
        anthropic: fakeAnthropic({
          ...((await import('./helpers.js')).SAMPLE_LISTING),
          categoryQuery: 'quantum blockchain llamas',
        }),
        log: (l) => lines.push(l),
        confirm: async () => false,
      },
    );

    expect(result.categoryFellBack).toBe(true);
    expect(result.category?.id).toBe('cat-gd');
    expect(lines.join('\n')).toContain('falling back');
  });

  it('never leaks the API key into log output', async () => {
    const { impl } = fakeFetch({
      'GET /api/categories': { json: { success: true, data: SAMPLE_TREE } },
    });
    const getly = new Getly({ apiKey: 'getly_sk_live_SECRETSECRET', fetch: impl });
    const lines: string[] = [];
    await runAutoStore(
      { folder: dir, dryRun: true },
      { getly, fetchImpl: impl, anthropic: fakeAnthropic(), log: (l) => lines.push(l), confirm: async () => false },
    );
    expect(lines.join('\n')).not.toContain('SECRETSECRET');
  });
});
