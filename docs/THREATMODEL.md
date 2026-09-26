# Threat model — Bonded, Commerce Edition

CLAUDE.md rule 6: what is NOT built is written here before anything else in `docs/`, and every
scope cut is written here in the same sentence it is made. This file is updated as the build
proceeds; the date on each entry is when the decision was made.

## 2026-09-26 — Pivot from the Hostage Protocol

The project changed direction: `BONDED_HOSTAGE_PROTOCOL_PRD_ALIGNED.md` (a customs-bond mechanism
for agent-to-agent payments, targeting Intercepta/Sui/World/ENS/Curvegrid) is abandoned. The build now
follows `BONDED_COMMERCE_MIGRATION_PRD.md`, migrating the original `BONDED_IMPLEMENTATION_PRD.md`
enforcer (The Graph/Arc/Ledger) to Intercepta + Sui + World only. Curvegrid/MultiBaas and ENS are out
of scope by explicit user direction, not by the PRD's own cut order.

What carried over unmodified in spirit, rebuilt in code because the prior git history was deleted
before this pivot (see FEEDBACK/sui.md): the fixed-point money discipline, the re-derivation
architecture, and the World OIDC sandbox findings in `docs/VERIFY_FINDINGS.md`. What did not carry
over: the Hostage bond vault's stake-multiplier math, ENS records, MultiBaas webhooks, and the
customs-bond framing itself.

## The disclosure this build must state honestly (PRD Part D.4, I.4)

> "On the issuer oracle, honestly: there is no universal API a hackathon team can call for real
> primary-ticket-issuer truth, so ours is a controlled reference service seeded with known data,
> standing in for what a production integration with a real issuer or merchant system would provide.
> We'd rather say so than dress a fixture up as a live feed."

`packages/issuer-oracle` is that fixture. It is isolated in its own package, on purpose, so this
honesty question has a one-package answer. Everything downstream of it — the enforcer's re-derivation
loop, the Intercepta adapter, the Sui settlement objects, the World step-up — is real and live.

## Out of scope, stated rather than implied

| We do not defend against | Why it is out of scope | What would close it |
|---|---|---|
| A compromised `EnforcerCap` holder beyond the object-capability boundary | The capability is the adjudication boundary | Multi-party adjudication (m-of-n caps) |
| Intercepta being wrong | The oracle is trusted for payment-side risk | A second, independent risk source |
| The issuer-oracle's fixture data not matching a real merchant | It is a disclosed stand-in, not a production integration | A real primary-issuer/merchant API integration |
| Every possible attacker-writable field | Only price, event status and seller-authorization are re-derived | A broader premise vocabulary |
| Live legal KYC beyond World's own verification | World's sandbox proof is the identity check this build uses | A production KYC/AML integration |

## 2026-09-26 — B2B pivot: Business Email Compromise (BEC) in accounts-payable automation

The pitch is now a definite, named B2B use case rather than a generic "agentic commerce" demo: an
autonomous AP agent pays a vendor invoice, and the invoice or a "we changed our bank account" email
was spoofed by an attacker impersonating the real vendor. This is not a hypothetical threat —
**Business Email Compromise cost $3.04 billion in 2025 per the FBI's IC3 2025 Annual Report** (up
from $2.77B the year before; BEC is the #2 crime type by total dollar loss; ~$123,000 average loss
per incident; 86% of losses moved via wire/ACH), and it is the concrete reason enterprises currently
refuse to let agents touch payables autonomously. Source:
https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf — fetched and verified before writing
this figure down; never guessed.

**Delivery form, decided:** an npm SDK first (`packages/seam`, `enforcer`, `dispatcher`,
`issuer-oracle`, `intercepta-adapter`, `world-agents` are all already shaped for publishing —
`exports`/`main`/`types`/`files`, just `"private": true`), with `packages/mcp-server` as a thin MCP
wrapper — the concrete, working answer to "usable inside an agent framework with no glue code." A
hosted multi-tenant gateway is named as roadmap only; it was not built.

**The BEC-specific mechanism, additive to the enforcer, not a rewrite:** a `Premise` can now be
marked `holdOnMismatch: true`. On mismatch, this produces `HELD_FOR_STEPUP` /
`PREMISE_HELD_FOR_REVIEW` instead of a hard `REFUSED`. This exists because a vendor's payout address
changing is simultaneously the actual fraud signal *and* something that happens legitimately — a
blanket refuse is unusable in practice, so this specific mismatch is routed to a mandatory human/
World-ID check instead of an automatic block. An invoice amount mismatch or a suspended vendor,
by contrast, still hard-refuses: those are not "maybe legitimate."

**The vendor-master oracle is the new disclosed stand-in**, replacing the ticket/ecomm framing as
the primary pitch narrative (their fixtures and tests stay; they're demoted to "also demonstrated,"
not deleted). Same honesty rule as before, restated for this data: `packages/issuer-oracle`'s
`vendor-fixture.ts` is a controlled, seeded stand-in for a real vendor-master/ERP system (NetSuite,
SAP, QuickBooks, etc.), never presented as a live feed.

**A real limitation found while building the demo villain, not fixed and not hidden:** every payout
address in this project's fixtures is Sui-shaped (32 bytes). Intercepta's screening endpoints only
accept a 20-byte EVM address or an ENS name (`docs/VERIFY_FINDINGS.md` item 5). This means the
optional "screen the fraudulent payout address via Intercepta" step in `packages/villain-corpus`
cannot run for this address format — with or without a real API key — and correctly fails visibly
rather than being silently skipped. **What would close it:** a real deployment would need vendor
payout addresses tracked as EVM addresses (or a linked EVM identity per vendor, the same
Sui/EVM-linkage pattern the abandoned Hostage Protocol design used for agent identity) so Intercepta
can actually screen them; Sui remains the settlement/audit-trail layer regardless.

**Newly built, all verified independently (not taken on a subagent's word) and committed:**
`packages/enforcer` (with `holdOnMismatch`), `packages/dispatcher` (the schema-to-adapter router
`enforce()` always assumed existed but nothing built until now), `packages/issuer-oracle`'s vendor
fixture, `packages/villain-corpus` (the spoofed-invoice artifact, replacing the earlier planned
scalper-ticket villain as the primary demo), `packages/mcp-server`, and `apps/console`'s Invoice
Inbox + step-up route.

## Not yet built

- `move/` — the Hostage-era `bond_vault` package (`0x990acf44…0d43` on Sui testnet) is abandoned;
  a Commerce Edition `bonded_registry` + `bonded_vault` (`0xf3d914b3…bf57a`) is live, but nothing in
  this B2B pivot's TypeScript layer settles against it yet — `enforce()`'s output is not currently
  wired to a real on-chain `settle`/`settle_with_stepup` call from the console or MCP server. This is
  the largest remaining gap before an end-to-end, on-chain demo is possible.
- `site/spoofed-invoice.html` (in `packages/villain-corpus`) is a complete, real static file but is
  **not hosted anywhere** — needs an actual Vercel/GitHub Pages deployment so it's a clickable,
  inspectable artifact, not just a local file.
- A natural-language "intent → PolicyArtifact" compiler — explicitly out of scope. Every
  `PolicyArtifact` in this build (villain-corpus, console, mcp-server) is a hand-authored object,
  same as the test fixtures; disclosed as a scope limit, not a gap silently filled.
- A hosted, multi-tenant API gateway — named as roadmap only, per the delivery-form decision above.
