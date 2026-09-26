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

**Spec:** [`BONDED_COMMERCE_MIGRATION_PRD.md`](BONDED_COMMERCE_MIGRATION_PRD.md) (migrating
[`BONDED_IMPLEMENTATION_PRD.md`](BONDED_IMPLEMENTATION_PRD.md)) · **Working rules:**
[`CLAUDE.md`](CLAUDE.md) · **What is and isn't built, plus the live build log:**
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
| `packages/issuer-oracle` | Vendor-master truth (disclosed stand-in for a real ERP/vendor-master system) |
| `packages/intercepta-adapter` | Live Intercepta payment-risk screening (EVM/ENS only — see the Sui/EVM note below) |
| `packages/world-agents` | World ID step-up for the payout-address-changed / irreversible case |
| `move/` | Sui settlement objects (`Verdict`, consumed on settle — see `move/DEPLOYMENTS.md`) |
| `packages/villain-corpus` | The spoofed-invoice demo artifact + three real, no-mock `enforce()` outcomes |
| `apps/console` | Invoice Inbox — real premise-diff table, real verdict, real step-up route |

**Known limitation, stated plainly:** every payout address in this demo is Sui-shaped, and
Intercepta only screens 20-byte EVM addresses or ENS names — so the Intercepta leg of the villain
demo fails visibly rather than running. A real deployment needs vendor payout addresses tracked as
(or linked to) EVM addresses. Full detail in `docs/THREATMODEL.md`.

**Still needed to close the loop:** Sui settlement isn't wired to the enforcer's output yet
(`enforce()`'s `CLEARED` verdict doesn't currently trigger a real `settle()` call), and the spoofed
invoice page isn't hosted anywhere public yet. Both are named next steps, not silent gaps.
