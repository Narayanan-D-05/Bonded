# Bonded — B2B: stopping vendor-invoice fraud in AP automation

Business Email Compromise cost **$3.04 billion in 2025** — the FBI IC3's #2 crime type by total
dollar loss, ~$123,000 average loss per incident, 86% moved via wire/ACH before anyone notices.
([2025 IC3 Annual Report](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf)) It's the
concrete reason enterprises still refuse to let an AI agent touch accounts payable autonomously: an
attacker impersonates a real vendor, sends a spoofed invoice or a "we changed our bank account"
email, and the agent pays the fraudulent account.

Bonded sits between that agent's decision to pay and the payment itself, and independently
re-derives the facts the payment relies on — the vendor's real payout address on file, its invoice
amount, whether it's suspended — right before money moves. A payout-address change is never
auto-approved *or* auto-refused: it's the one signal that always forces a fresh human/World ID
check, because vendors do legitimately change banks sometimes. Everything else that's wrong just
gets refused.

**Spec:** [`BONDED_PRD.md`](BONDED_PRD.md) · **Sponsors, in detail:** [`sponsers.md`](sponsers.md) ·
**Working rules:** [`CLAUDE.md`](CLAUDE.md) · **What is and isn't built, plus the live build log:**
[`docs/THREATMODEL.md`](docs/THREATMODEL.md)

Sponsors: **Intercepta · Sui · World (ID for Agents).**

## How it's delivered

- **`packages/enforcer` + friends are an installable SDK.** Any AP platform's own backend calls
  `enforce(proposal, policy, onchainPolicyHash, deps)` before executing a payment — no service to
  stand up, no vendor lock-in to a hosted API.
- **`packages/mcp-server` is the plugin form** — one tool, `bonded_verify_invoice_payment`, addable
  to any MCP-capable agent framework with zero glue code. See its own
  [README](packages/mcp-server/README.md) for both integration paths side by side.
- A hosted, multi-tenant gateway is roadmap, not built — see `docs/THREATMODEL.md`.

## What's real right now

| Package | What it does |
|---|---|
| `packages/seam` | Shared types, fixed-point money math |
| `packages/enforcer` | The refusal/hold engine — five checks, zero chain dependency |
| `packages/dispatcher` | Routes a policy's premise to the adapter that owns it |
| `packages/issuer-oracle` | Vendor-master truth: the disclosed fixture (default), or a real Xero org (`VENDOR_MASTER_SOURCE=xero`) |
| `packages/intercepta-adapter` | Live Intercepta screening of the payee's claimed EVM identity (fail-closed without a key) |
| `packages/world-agents` | World ID step-up for the payout-address-changed / irreversible case |
| `packages/sui-settlement` | Submits the real Sui settlement for a verdict (`settleCleared`, `settleWithStepUp`); reads the policy hash and vault spend on-chain |
| `move/` | Sui settlement objects (`Verdict`, consumed on settle — see `move/DEPLOYMENTS.md`) |
| `packages/villain-corpus` | The spoofed-invoice demo artifact + three key-free, no-mock `enforce()` outcomes + a key-gated screen |
| `apps/console` | Invoice Inbox — real premise-diff table, real verdict, automatic Sui payout on `CLEARED`, real step-up route |

**The loop is closed for the clean case, on testnet.** `POST /api/enforce` reads the AP agent's policy
hash from `BondedRegistry` and the budget from the vault's real `spent_this_period`, runs `enforce()`,
and on `CLEARED` pays the vendor-master address (never the address the invoice claims). Each invoice
pays at most once. Live: acme was paid through the console route, digest
`BkuSQ6nhyEXBXvGs9X3kiX3WVgTkPZ9HAkEdNgDqwP69`; a second POST returned the same digest and paid
nothing. Every digest is in `move/DEPLOYMENTS.md`.

**Demo invoices:** acme `CLEARED` and paid · spoofed globex (claims a real OFAC-listed Lazarus Group
EVM address) refused by the Intercepta screen · suspended-corp refused · globex genuine bank change
`HELD` for World step-up · halcyon ($15,000) `HELD` over the $10,000 irreversible threshold, then
`settleWithStepUp`. The last two need keys.

**Stated plainly:**
- None of the Intercepta, World or Xero flows has run live yet; each needs the keys below. Without
  `INTERCEPTA_API_KEY` the screened invoices fail closed (`REFUSED` / `PREMISE_UNRESOLVABLE`), never
  pass.
- Intercepta screens the EVM identity the payee *claims*, not the Sui address the money goes to. The
  link is asserted by the invoice, backed by a hard-refuse check that the claimed identity matches the
  vendor's registered one.
- The vendor master is still the disclosed fixture by default. The spoofed-invoice page isn't hosted
  publicly. There's no policy compiler, and the World identity isn't linked to a Sui account.
- Opening an invoice detail page triggers the agent's POST, which pays if `CLEARED`.

Full detail in `docs/THREATMODEL.md`.

## Keys you need to add

Put these in `.env` (copy `.env.example`; `.env` is never committed). Sui signing uses the Sui CLI
keystore, not `.env`.

| Key | Where to get it | What it unlocks |
|---|---|---|
| `INTERCEPTA_API_KEY` | intercepta.io/ethglobal | The live screen (globex and halcyon invoices, villain-corpus scenario 4) |
| `WORLD_SANDBOX_CLIENT_ID`, `WORLD_SANDBOX_CLIENT_SECRET`, `WORLD_REDIRECT_URI` | The World sandbox portal. The redirect URI must be HTTPS, so expose the console through a tunnel | The step-up, and with it `settleWithStepUp` and the bank-change approval |
| `VENDOR_MASTER_SOURCE=xero`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` (optional `XERO_TENANT_ID`) | A Xero Custom Connection against the Demo Company (free for development) | The real accounting system. Then run `pnpm --filter @bonded/issuer-oracle xero:setup`, and `xero:check` to read it back |

Also get the pinned known-risk test addresses from Intercepta's Discord, to confirm what a flagged
address returns before relying on the screen. Note: re-running `xero:setup` reverts an approved bank
change in Xero.
