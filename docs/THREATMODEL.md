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

## 2026-09-26 (later) — Screening, auto-settlement and a real accounting connector

This entry **supersedes** two statements above without deleting them: the "Sui-address limitation"
paragraph in the B2B-pivot entry, and the "Not yet built" list. Both were true when written. The
current list is at the end of this entry.

**Intercepta now screens the payee's claimed EVM identity, not the Sui payout address.** The earlier
statement that the Intercepta leg "cannot run for this address format" is no longer true.
`VendorTruth` gained `evmAddress`, the payee's registered 20-byte EVM identity. An invoice now claims
an EVM identity for the payee as well as a Sui payout address. The screen premise is
`intercepta-risk` / `payment.payTo.traitCount lte 0`, with its subject bound from the proposal's own
claim by `@bonded/dispatcher`'s `bindClaimArgs` (`args: ['claim:p-<vendor>-evm-identity']`). Any
documented risk trait (`sanction_address`, `known_scammer`, `mixer_transfers`, ...) means a hard
`REFUSED`. No `toxicScore` threshold is invented; its range is still undocumented
(`docs/VERIFY_FINDINGS.md` item 5). The screen runs **before** the `holdOnMismatch` payout premise, so
a sanctioned identity is refused outright and never held for a human who might approve it. A second
hard-refuse premise (`vendor.evmAddress eq`) then requires the claimed identity to match the one on
file.

The spoofed invoice (`packages/villain-corpus/site/spoofed-invoice.html`,
`#claimed-evm-identity[data-address]`) claims a real OFAC-listed address: Lazarus Group
`0x098b716b8aaf21512996dc57eb0615e2383e2f96`, SDN entry 27307, program DPRK3, added 2022-04-14.
Tornado Cash addresses were not used, because OFAC delisted them on 2025-03-21.

`@bonded/dispatcher`'s `failClosedTable` wraps `intercepta-risk`: a missing `INTERCEPTA_API_KEY`, an
HTTP error or an unexpected shape becomes `null`, so the verdict is `REFUSED` /
`PREMISE_UNRESOLVABLE`, and the error is returned in `screeningErrors`. No screen result is ever
invented. **The screen has not run live yet; it needs `INTERCEPTA_API_KEY`.**

**The remaining honest caveat:** the screen checks the identity the payee *claims*, not the Sui
address the money actually goes to. The link between the two is asserted by the invoice. It is backed
by the hard-refuse identity premise (the claimed EVM identity must equal the vendor's registered one),
and settlement always pays the vendor master's Sui address, never the claim. It is not a
cryptographic proof that the EVM identity controls the Sui address.

**Automatic Sui payout is built and has run live.** `packages/sui-settlement` and
`apps/console/lib/payment.ts`: `POST /api/enforce` reads `onchainPolicyHash` from `BondedRegistry`
(never recomputed locally) and the budget from the vault's real on-chain `spent_this_period`. On
`CLEARED` it calls `settleCleared`, which always pays the vendor-master address re-derived by
`deriveVendorRecipient`, never the address in the claim. A settle-once ledger
(`.data/console/settlements.json`, keyed by `proposalHash`) makes each invoice pay at most once. Live
proof: acme paid through the console route, digest `BkuSQ6nhyEXBXvGs9X3kiX3WVgTkPZ9HAkEdNgDqwP69`
(1,250,000,000 base units to `0x4d5a…d3e0`); a second POST returned the same digest with
`alreadySettled: true` and paid nothing. Every digest, including the one-AP-policy commit and the
USDSUI mints via the TreasuryCap, is in `move/DEPLOYMENTS.md`. **`settleWithStepUp` has not run live;
it needs World credentials.**

**One AP-agent policy.** `BondedRegistry` holds one hash per agent, so the console enforces every
vendor's invoice against one committed `PolicyArtifact` (`apps/console/lib/ap-policy.ts`). No premise
`value` embeds a vendor-master fact, so a bank change doesn't change the policy hash. The budget period
is labelled `vault-lifetime`, because `spent_this_period` never resets on-chain; this is a disclosed
limit, not a daily budget.

**A real accounting-system connector: Xero** (`packages/issuer-oracle/src/sources/xero.ts`), selected
by `VENDOR_MASTER_SOURCE=fixture|xero`. The fixture stays the default. It uses a Custom Connection,
which is free against the Xero Demo Company. Payout identities live in the supplier's
`BankAccountDetails` as `bonded:v1;sui=…;evm=…`, because Xero has no wallet field and bank details are
exactly the field a BEC attacker asks AP to change. Xero has no bank-detail-change timestamp, so
`UpdatedDateUTC` (last contact update) is used; it errs toward more holds, never fewer. Setup and
read-back scripts: `xero:setup`, `xero:check`. **It has not run live; it needs Xero credentials.**
Caveat: re-running `xero:setup` writes the fixture values back, which reverts an approved bank change
in Xero.

**Approving a bank change.** An approved `PREMISE_HELD_FOR_REVIEW` step-up no longer pays anything
directly. It writes the confirmed new address to the vendor master (Xero `BankAccountDetails`, or the
disclosed, append-only `.data/vendor-master-changes.json` overlay in fixture mode, recording the World
`sub`, `authTimeMs` and `proposalHash`), then re-runs `enforce()`; the now-matching claim clears and
pays the updated truth. An `IRREVERSIBLE_UNCONFIRMED` approval goes to `settleWithStepUp` and pays the
address on file.

**Demo invoices now in the console** (`inv-*`): acme `CLEARED` and paid; spoofed globex refused by the
screen (fail-closed `REFUSED` without a key); suspended-corp refused; globex genuine bank change
`HELD`, needs keys; `vnd-halcyon-machining` ($15,000) `HELD` for being over the $10,000 irreversible
threshold, then `settleWithStepUp`, needs keys.

**Known UX caveats, not fixed:** opening an invoice detail page triggers the agent's
`POST /api/enforce`, which pays if the verdict is `CLEARED` (paying is the agent's action, not a human
button; the page just triggers it). A settlement that fails midway with an unknown outcome is recorded
as `unknown` in the ledger and left for manual review; it is never retried automatically, because a
retry could pay twice.

### Not yet built (as of this entry; replaces the list above)

- **None of the Intercepta, World or Xero flows has run live.** Each needs keys: `INTERCEPTA_API_KEY`;
  `WORLD_SANDBOX_CLIENT_ID` / `WORLD_SANDBOX_CLIENT_SECRET` / `WORLD_REDIRECT_URI`; `XERO_CLIENT_ID` /
  `XERO_CLIENT_SECRET` with `VENDOR_MASTER_SOURCE=xero`. The globex bank-change and halcyon scenarios,
  and `settleWithStepUp`, wait on these.
- **The vendor master is still the disclosed fixture by default.** The Xero connector exists but is
  opt-in and unrun.
- **`site/spoofed-invoice.html` is not hosted publicly.**
- **No natural-language "intent → PolicyArtifact" compiler.** Every policy is hand-authored.
- **The World identity is not linked to a Sui account.** The step-up proves a fresh human for one
  proposal; it doesn't bind that human to an on-chain address.
- **The screened EVM identity is not cryptographically linked to the Sui payout address** (see the
  caveat above).
- A hosted, multi-tenant API gateway remains roadmap only.

## 2026-09-26 — Intercepta screen verified live

With a real `INTERCEPTA_API_KEY`, the console's five invoices were run through a fresh dev server:
acme returned its recorded settlement (no second payment); suspended-corp REFUSED /
PREMISE_MISMATCH; the spoofed globex invoice REFUSED / PREMISE_MISMATCH on a live screen of the
OFAC-listed Lazarus address (5 risk traits, toxicScore 100); the genuine globex bank change and the
$15,000 halcyon invoice both screened clean (0 traits) and are HELD_FOR_STEPUP. The first live call
exposed an Intercepta schema mismatch (`txsCount` absent on some traits), fixed in the adapter; see
FEEDBACK/intercepta.md. Still not run live: the World step-up and `settleWithStepUp` (needs a person
to complete World ID on a phone), and the Xero source (needs Xero credentials).
