/**
 * @bonded/mcp-server — public index.
 *
 * This package's real product is `bin/bonded-mcp` (`./dist/server.js`, see
 * `server.ts`) — the stdio MCP server a client adds with `claude mcp add
 * bonded-mcp -- node ./dist/server.js` (see this package's README.md). This
 * index exists so the same tool handler can ALSO be imported directly by a
 * backend that wants the SDK path instead of the MCP-client path, without
 * spawning a subprocess — the two integration paths this package's README
 * documents side by side.
 *
 * Deliberately does NOT re-export anything from `server.ts`: that file's
 * module-level `main()` call connects a real `StdioServerTransport` (reads
 * stdin / writes stdout) as a side effect of being run as the `bin` entry
 * point. Re-exporting from it here would make importing `@bonded/mcp-server`
 * for its SDK path ALSO try to start a stdio server — wrong for a library
 * import, and exactly the kind of surprising side effect this package's
 * own tests must not trigger. `server.ts` is only ever meant to be executed
 * directly (`node ./dist/server.js`), never imported.
 */
export {
  verifyInvoicePayment,
  verifyInvoicePaymentInputShape,
  verifyInvoicePaymentInputSchema,
  type VerifyInvoicePaymentInput,
  type VerifyInvoicePaymentResult,
  type PremiseDiff,
  type SerializedVerdict,
} from './tools/verify-invoice-payment.js';
