/**
 * Getly MCP server — stdio transport, programmatic export.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools.js';

export const SERVER_NAME = 'getly';
export const SERVER_VERSION = '0.3.0';

const INSTRUCTIONS = [
  'Run the user\'s Getly digital-products store: products, blog posts, coupons, checkout links, license keys, orders, sales stats, and Getly Billing plans/subscriptions for the user\'s own product.',
  'Money is ALWAYS integer cents (priceCents, valueCents).',
  'Destructive or revenue-affecting tools (publish_product, archive_product, create_coupon at 50%+ discount, cancel_billing_subscription) require confirm: true — always ask the human user before setting it.',
  'Buyers pay with PayPal or USDT/USDC today (card checkout is paused). Seller payouts are USDT/USDC on BNB Smart Chain (min $5) or USDT on Tron (min $15), on the 1st and 15th.',
  'The API key is read from the GETLY_API_KEY environment variable only. Never ask the user to paste a key into chat; point them to `npx @getly/mcp init`.',
].join('\n');

/** Build a configured McpServer with all Getly tools registered. */
export function createGetlyMcpServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { title: tool.annotations.title, ...tool.annotations },
      },
      (async (args: Record<string, unknown>) =>
        tool.handler(args ?? {})) as Parameters<typeof server.registerTool>[2],
    );
  }

  return server;
}

/** Start the server on stdio (used by the CLI). Never writes to stdout. */
export async function startStdioServer(): Promise<void> {
  const server = createGetlyMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[getly-mcp] server ready (${TOOLS.length} tools). Key configured: ${process.env.GETLY_API_KEY ? 'yes' : 'NO — tools will return setup instructions'}`);
}
