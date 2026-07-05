import { describe, it, expect } from 'vitest';
import { maskKey, mergeMcpConfig } from '../src/init.js';

describe('maskKey', () => {
  it('shows only the last 4 characters', () => {
    const key = 'getly_sk_live_abcdef1234567890';
    const masked = maskKey(key);
    expect(masked.endsWith('7890')).toBe(true);
    expect(masked).not.toContain('abcdef');
    expect(masked).not.toContain('getly_sk_live_');
  });

  it('never returns the input for short keys', () => {
    expect(maskKey('abc')).toBe('****');
  });
});

describe('mergeMcpConfig', () => {
  it('creates a fresh config when no file exists', () => {
    const merged = mergeMcpConfig(null, 'getly_sk_live_x');
    const parsed = JSON.parse(merged!) as { mcpServers: Record<string, { command: string; env: Record<string, string> }> };
    expect(parsed.mcpServers.getly.command).toBe('npx');
    expect(parsed.mcpServers.getly.env.GETLY_API_KEY).toBe('getly_sk_live_x');
  });

  it('preserves other servers when merging', () => {
    const existing = JSON.stringify({
      mcpServers: { other: { command: 'foo', args: [] } },
      theme: 'dark',
    });
    const merged = mergeMcpConfig(existing, null);
    const parsed = JSON.parse(merged!) as Record<string, any>;
    expect(parsed.mcpServers.other.command).toBe('foo');
    expect(parsed.mcpServers.getly.env.GETLY_API_KEY).toBe('YOUR_GETLY_API_KEY');
    expect(parsed.theme).toBe('dark');
  });

  it('refuses to clobber invalid JSON', () => {
    expect(mergeMcpConfig('{ not json', 'k')).toBeNull();
    expect(mergeMcpConfig('[1,2,3]', 'k')).toBeNull();
  });
});
