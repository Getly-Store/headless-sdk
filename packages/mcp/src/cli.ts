#!/usr/bin/env node
/**
 * getly-mcp CLI:
 *   getly-mcp             → start the stdio MCP server
 *   getly-mcp init        → interactive client setup (Cursor/Claude/Windsurf)
 *   getly-mcp init --print → print all config snippets, write nothing
 */
import { runInit } from './init.js';
import { startStdioServer } from './server.js';

const command = process.argv[2];

if (command === 'init') {
  await runInit(process.argv.slice(3));
} else if (command === '--help' || command === '-h' || command === 'help') {
  process.stderr.write(
    [
      'Usage: getly-mcp [command]',
      '',
      '  (no command)   start the MCP server on stdio',
      '  init           set up Claude Code / Cursor / Claude Desktop / Windsurf',
      '  init --print   print config snippets without writing any files',
      '',
      'The Getly API key is read from the GETLY_API_KEY environment variable.',
      'Create one: https://www.getly.store/dashboard/developer/keys',
      '',
    ].join('\n'),
  );
} else {
  await startStdioServer();
}
