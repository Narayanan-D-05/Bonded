# @bonded/mcp-server

The repo's first `bin` entry, and the concrete answer to "usable inside an
agent framework with no glue code." Exposes one tool,
`bonded_verify_invoice_payment`, over stdio via the
[Model Context Protocol](https://modelcontextprotocol.io) — the AP/BEC
(Business Email Compromise) vendor-invoice-payment check from this repo's
plan (build-order item 8).

Before an autonomous AP agent pays a vendor invoice, this tool independently
re-derives the vendor's true payout address, invoice amount, and account
status from the disclosed vendor-master oracle (`@bonded/issuer-oracle`) and
runs the real `enforce()` decision loop (`@bonded/enforcer`) against them —
the same mechanism Bonded uses everywhere else in this repo, wrapped so an
agent framework can call it without writing any glue code of its own.

It owns **no enforcement logic**. Every decision comes from
`@bonded/enforcer`'s `enforce()`, routed through `@bonded/dispatcher`'s
`createEnforceDeps`/`createResolvePremise`/`canonicalHash`, against
`@bonded/issuer-oracle`'s real, disclosed vendor fixture. This package is
policy shape + SDK plumbing only. See `src/tools/verify-invoice-payment.ts`
for the full, documented policy rationale (why a `vendor.status` premise
exists, why a payout-address mismatch is held for a human step-up rather than
refused outright, why an amount mismatch beyond 0.5% is refused outright
instead, and the demo budget/threshold values chosen).

## Two integration paths, side by side

Bonded is delivered SDK-first, with this MCP server as a thin wrapper once
that SDK exists. Both paths call the exact same code
(`verifyInvoicePayment` in `src/tools/verify-invoice-payment.ts`) — this
package adds no logic of its own on top of it, only two different ways to
reach it.

### (a) Direct SDK usage in a backend

An AP platform's own backend calls the same building blocks this package
wraps, with zero MCP involved at all:

```ts
import { enforce } from '@bonded/enforcer';
import { createEnforceDeps, canonicalHash } from '@bonded/dispatcher';
import { issuerOracleVendors } from '@bonded/issuer-oracle';

// Or, even more directly, reuse this package's own tool handler and skip
// hand-rolling the PolicyArtifact/Proposal shape yourself:
import { verifyInvoicePayment } from '@bonded/mcp-server';

const result = await verifyInvoicePayment({
  vendorId: 'vnd-globex-freight',
  claimedPayoutAddress: '0x...',       // the payout address the invoice/email claims
  claimedInvoiceAmountUSD: '8450000000', // 6-decimal base units, $8,450.00 — always a string
  agent: '0x1111111111111111111111111111111111111111', // the paying agent's identifier
});

if (result.verdict.outcomeLabel === 'HELD_FOR_STEPUP') {
  // result.mismatches[] has the claimed-vs-derived pair that triggered the hold —
  // never a bare "this looked suspicious" claim (CLAUDE.md rule 5).
  console.log(result.mismatches);
}
```

This is the lowest-friction, most-believable integration for a real AP
platform's own backend — no subprocess, no protocol, just a function call
against the real `enforce()` loop.

### (b) Adding this server to an agent's toolset (the "plugin" path)

Build this package, then register it with any MCP-aware agent host. For
[Claude Code](https://claude.com/claude-code) specifically, the real,
current invocation (verified against the installed `claude` CLI's own
`--help` output, not guessed):

```sh
pnpm --filter @bonded/mcp-server build
claude mcp add bonded-mcp -- node ./packages/mcp-server/dist/server.js
```

Any other MCP host that can spawn a stdio server points at the same built
entry point (`node ./dist/server.js` from this package's own directory, or
the `bonded-mcp` bin once this package is installed/linked). Once added,
the agent sees exactly one tool:

- **`bonded_verify_invoice_payment`** — input: `vendorId` (string),
  `claimedPayoutAddress` (0x-hex string), `claimedInvoiceAmountUSD`
  (6-decimal base-unit integer string), `agent` (0x-hex address-like
  identifier for the paying agent). Output: a `CLEARED` / `REFUSED` /
  `HELD_FOR_STEPUP` verdict, plus the exact claimed-vs-derived evidence for
  any mismatched or held premise, plus the `PolicyArtifact` the call was
  checked against.

An agent that calls this tool before executing a vendor payment gets the
same independent re-derivation of the truth that this project's thesis is
built on — from inside its own toolset, with no bespoke integration code.

## What this demo tool does NOT do (stated, not silently omitted)

- **No Intercepta wiring.** `@bonded/intercepta-adapter`'s `interceptaRisk`
  table is not in this tool's schema registry. It needs a chain id this
  tool's input has no way to supply and a live `INTERCEPTA_API_KEY` this
  tool cannot guarantee at call time — wiring it in without both would mean
  either guessing a chain id or crashing every key-less call. Screening the
  claimed payout address through Intercepta is a real, valuable next step,
  just not one this pass includes. See `verify-invoice-payment.ts`'s file
  header for the full reasoning.
- **No real Sui checkpoint.** `getCheckpoint()` returns the current
  unix-seconds timestamp as a deterministic stand-in — safe only because
  every adapter wired into this tool (`@bonded/issuer-oracle`) ignores the
  pinned checkpoint entirely (confirmed in `@bonded/dispatcher`'s own doc
  comments). `Verdict.blockChecked` in this tool's output is not a real Sui
  checkpoint and must never be presented as one.
- **No persistent spend ledger.** Each tool call is stateless;
  `sumRecentSpend` truthfully reports `0n` rather than fabricating a running
  total. A real deployment (e.g. `apps/console`'s composition point) wires
  this to the actual ledger.
- **No live on-chain policy lookup.** `onchainPolicyHash` is computed via
  `@bonded/dispatcher`'s `canonicalHash` against the exact same
  `PolicyArtifact` object this tool just built and passed to `enforce()`, so
  it always matches and `enforce()` never trips `STALE_POLICY` spuriously.
  A real deployment reads this from the actual on-chain `bonded_registry`.

## Build / test

```sh
pnpm --filter @bonded/mcp-server build
pnpm --filter @bonded/mcp-server test
```

Tests call `verifyInvoicePayment` directly (never over stdio, never through
a real MCP client) against `@bonded/issuer-oracle`'s real seeded vendor
fixture — no mocks:

- `vnd-globex-freight` with a claimed payout address that does not match the
  real one on file → `HELD_FOR_STEPUP` / `PREMISE_HELD_FOR_REVIEW`.
- `vnd-suspended-corp` (even with a correct claimed address and amount) →
  `REFUSED` / `PREMISE_MISMATCH`.
- `vnd-acme-supplies` with a correct claim → `CLEARED` / `OK`.

## External dependencies

This package is the first in the repo to need a real MCP SDK, so it adds two
genuinely new dependencies at the repo root (neither existed anywhere in
`pnpm-lock.yaml` before this package):

- `@modelcontextprotocol/sdk` `^1.30.1` — resolved `1.30.1` at the time this
  package was built (checked via `pnpm info`, not guessed from an older
  memory of the SDK).
- `zod` `^4.6.5` — resolved `4.6.5`; satisfies the SDK's own
  `peerDependencies` range (`^3.25 || ^4.0`).
