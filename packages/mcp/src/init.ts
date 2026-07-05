/**
 * `npx @getly/mcp init` — interactive-lite setup for MCP clients.
 *
 * Detects Claude Code, Cursor, Claude Desktop and Windsurf; prints the
 * copy-paste snippet for each and (for JSON-config clients) offers to write
 * the config, merging existing JSON safely. `--print` only prints, never
 * writes. The API key is NEVER echoed in full — masked to the last 4 chars.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const KEY_URL = 'https://www.getly.store/dashboard/developer/keys';
const PLACEHOLDER = 'YOUR_GETLY_API_KEY';

/** Mask a secret: everything but the last 4 chars. Never returns the input. */
export function maskKey(key: string): string {
  if (key.length <= 4) return '****';
  return `${'*'.repeat(Math.min(key.length - 4, 20))}${key.slice(-4)}`;
}

interface JsonClient {
  name: string;
  configPath: string;
  detectPath: string;
  /** Top-level key that holds the servers map. */
  serversKey: 'mcpServers';
}

function jsonClients(): JsonClient[] {
  const home = homedir();
  const claudeDesktopDir =
    platform() === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Claude')
      : platform() === 'win32'
        ? join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude')
        : join(home, '.config', 'Claude');
  return [
    {
      name: 'Cursor',
      configPath: join(home, '.cursor', 'mcp.json'),
      detectPath: join(home, '.cursor'),
      serversKey: 'mcpServers',
    },
    {
      name: 'Claude Desktop',
      configPath: join(claudeDesktopDir, 'claude_desktop_config.json'),
      detectPath: claudeDesktopDir,
      serversKey: 'mcpServers',
    },
    {
      name: 'Windsurf',
      configPath: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      detectPath: join(home, '.codeium', 'windsurf'),
      serversKey: 'mcpServers',
    },
  ];
}

function serverEntry(key: string | null): Record<string, unknown> {
  return {
    command: 'npx',
    args: ['-y', '@getly/mcp'],
    env: { GETLY_API_KEY: key ?? PLACEHOLDER },
  };
}

/**
 * Merge the getly server into an existing MCP JSON config string.
 * Returns the new JSON, or null when the existing file is not valid JSON
 * (we refuse to clobber a file we cannot parse).
 */
export function mergeMcpConfig(existing: string | null, apiKey: string | null): string | null {
  let config: Record<string, unknown> = {};
  if (existing !== null && existing.trim() !== '') {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      config = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const servers =
    config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
      ? (config.mcpServers as Record<string, unknown>)
      : {};
  servers.getly = serverEntry(apiKey);
  config.mcpServers = servers;
  return JSON.stringify(config, null, 2) + '\n';
}

function snippetJson(apiKey: string | null): string {
  return JSON.stringify({ mcpServers: { getly: serverEntry(apiKey ? maskKey(apiKey) : null) } }, null, 2);
}

const log = (s = '') => process.stderr.write(s + '\n');

export async function runInit(argv: string[]): Promise<void> {
  const printOnly = argv.includes('--print');
  const apiKey = process.env.GETLY_API_KEY?.trim() || null;

  log('Getly MCP setup');
  log('===============');
  if (apiKey) {
    log(`Found GETLY_API_KEY in the environment (${maskKey(apiKey)}) — configs will use it.`);
  } else {
    log(`No GETLY_API_KEY set. Create a key at ${KEY_URL} (grant only the scopes you need),`);
    log(`then re-run with the env var set, or replace ${PLACEHOLDER} in the snippets below.`);
  }
  log();

  // Claude Code: one command, no file writing needed.
  log('Claude Code — run this in your terminal:');
  log(`  claude mcp add getly --env GETLY_API_KEY=${apiKey ? '<your key>' : PLACEHOLDER} -- npx -y @getly/mcp`);
  if (apiKey) log('  (substitute <your key> yourself — this tool never prints the full key)');
  log();

  const clients = jsonClients();
  const rl = printOnly ? null : createInterface({ input: process.stdin, output: process.stderr });

  for (const client of clients) {
    const detected = existsSync(client.detectPath);
    log(`${client.name}${detected ? ' (detected)' : ''} — ${client.configPath}:`);
    log(snippetJson(apiKey));
    log();

    if (printOnly || !detected || !rl) continue;

    const answer = (await rl.question(`Write this to ${client.configPath}? [y/N] `)).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') continue;

    const existing = existsSync(client.configPath)
      ? await readFile(client.configPath, 'utf8')
      : null;
    const merged = mergeMcpConfig(existing, apiKey);
    if (merged === null) {
      log(`  SKIPPED: ${client.configPath} exists but is not valid JSON — fix it manually, nothing was overwritten.`);
      continue;
    }
    await mkdir(dirname(client.configPath), { recursive: true });
    await writeFile(client.configPath, merged, 'utf8');
    log(`  Wrote ${client.configPath}${apiKey ? ` (key ${maskKey(apiKey)})` : ` — replace ${PLACEHOLDER} with your key`}. Restart ${client.name} to load it.`);
  }

  rl?.close();

  log('Security notes:');
  log('- These config files store the key in PLAINTEXT on this machine. Anyone with file access can read it.');
  log(`- Grant least-privilege scopes per workflow, and rotate/revoke keys at ${KEY_URL}.`);
}
