#!/usr/bin/env node
/**
 * `bonded-mcp` — the repo's first `bin` entry (plan build-order item 8).
 *
 * A stdio MCP server bootstrap registering exactly one tool,
 * `bonded_verify_invoice_payment` (see `tools/verify-invoice-payment.ts` for
 * everything the tool actually does and why). This file is deliberately
 * thin: it owns no enforcement logic, only the SDK plumbing to expose that
 * tool to an MCP client (Claude Code's `claude mcp add`, or any other MCP
 * host) over stdio.
 *
 * API shapes below are read directly from the installed
 * `@modelcontextprotocol/sdk@1.30.1`'s own `.d.ts` files
 * (`server/mcp.d.ts`, `server/stdio.d.ts`) — not guessed from memory of an
 * older SDK version, per CLAUDE.md's [VERIFY] rule:
 *   - `McpServer` and `StdioServerTransport` are NOT re-exported from the
 *     package's root or `./server` entry points (confirmed: neither
 *     `dist/esm/index.js` nor `dist/esm/server/index.d.ts` mentions them) —
 *     they are imported from their own subpaths,
 *     `@modelcontextprotocol/sdk/server/mcp.js` and
 *     `@modelcontextprotocol/sdk/server/stdio.js`, both of which the
 *     package's `exports` map serves via its `"./*"` wildcard entry.
 *   - `McpServer#registerTool(name, config, cb)` is the current, non-
 *     deprecated registration API (the older `tool(...)` overloads are
 *     explicitly marked `@deprecated Use registerTool instead` in the same
 *     file).
 *   - `config.inputSchema` takes a zod RAW SHAPE (a plain object of per-field
 *     zod schemas), not a `z.object(...)` instance — confirmed by
 *     `registerTool`'s own generic constraint,
 *     `InputArgs extends ... ZodRawShapeCompat ...`.
 *   - `server.connect(transport)` attaches to and starts the given
 *     `Transport`; `new StdioServerTransport()` (no constructor args needed
 *     for the default stdin/stdout wiring) is the transport for a stdio MCP
 *     server per `server/stdio.d.ts`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  verifyInvoicePayment,
  verifyInvoicePaymentInputShape,
  type VerifyInvoicePaymentInput,
} from './tools/verify-invoice-payment.js';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'bonded-mcp', version: '1.0.0' });

  server.registerTool(
    'bonded_verify_invoice_payment',
    {
      title: 'Verify vendor invoice payment (BEC / AP fraud check)',
      description:
        "Before an AP agent pays a vendor invoice, independently re-derives the vendor's true payout address, invoice amount, and account status from the disclosed vendor-master oracle, and returns a CLEARED / REFUSED / HELD_FOR_STEPUP verdict plus the exact claimed-vs-derived evidence for any mismatch. A payout-address mismatch is held for human step-up review (a vendor changing its real bank details is not itself fraud); a suspended-vendor or invoice-amount mismatch beyond a 0.5% tolerance is refused outright. If the optional claimedPayeeEvmAddress (the payee's 20-byte EVM identity) is given, it is screened live through Intercepta before the payout-address check: any documented risk trait refuses the payment, and a missing INTERCEPTA_API_KEY or a failed screen also refuses it (fail closed), with the error returned in screeningErrors. See this package's verify-invoice-payment.ts for the full policy rationale.",
      inputSchema: verifyInvoicePaymentInputShape,
    },
    async (args: VerifyInvoicePaymentInput) => {
      const result = await verifyInvoicePayment(args);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        // structuredContent must be JSON-serializable — result already has
        // every bigint (Verdict.blockChecked) turned into a string by
        // verifyInvoicePayment itself, so no cast/serialization is needed here.
        structuredContent: result as unknown as Record<string, unknown>,
        isError: result.verdict.outcome === 1,
      };
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('bonded-mcp: fatal error', error);
  process.exit(1);
});
