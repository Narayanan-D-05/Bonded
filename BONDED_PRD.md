# Bonded — Product Requirements Document (current, as-built)

**Status: this document describes what is actually built and verified in this repository, in the
present tense, as fact — not a plan, not a migration diff, not a hackathon pitch.** Every file path,
function signature, deployed address, and test count below was read or run directly against the real
repository on 2026-09-26. Where something could not be confirmed this way, it is stated as
unconfirmed rather than guessed (see "Honest disclosures" below).

**Revised later on 2026-09-26** for three changes, each re-read in the source: Intercepta now screens
the payee's claimed EVM identity (not the Sui payout address); a `CLEARED` verdict now settles on Sui
automatically from the console; and the vendor master can be a real Xero org. The test counts in §11
were re-run for this revision.

This supersedes two earlier documents, no longer present in the working tree (removed once this file
existed to replace them; both are still recoverable from git history): `BONDED_IMPLEMENTATION_PRD.md`
(the original ETHOnline Graph/Arc/Ledger spec) and `BONDED_COMMERCE_MIGRATION_PRD.md` (a migration
plan that had, at one point, targeted ENS and Curvegrid alongside a ticket-scalper demo — scope this
project never shipped and dropped before this document was written). Both described designs the
project moved past before being built out; neither reflects anything below.

---

## 1. What this is, in one page

**The problem.** Business Email Compromise (BEC) cost **$3.04 billion in 2025**, per the FBI's IC3
2025 Annual Report — up from $2.77B the year before, the #2 crime type by total dollar loss, with an
average loss of roughly $123,000 per incident, and about 86% of losses moving via wire or ACH before
anyone notices. (Source:
[2025 IC3 Annual Report](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf).) The most
common shape of this fraud in accounts payable (AP): an attacker impersonates a real vendor, sends a
spoofed invoice or a "we've changed our bank account" email, and whoever (or whatever) approves the
payment sends real money to the fraudulent account. This is the concrete, named reason enterprises
currently refuse to let an autonomous AP agent touch payables without a human in the loop for every
payment — which defeats the point of automating AP at all.

**The mechanism.** Bonded sits between an agent's decision to pay a vendor invoice and the payment
itself, and independently **re-derives** the facts that decision relies on — the vendor's true payout
address on file, the real invoice amount, whether the vendor account is in good standing — right
before money moves, against a source of truth the agent does not control. This is not a human-approval
gate on every payment (that would be the rubber-stamp failure mode this project explicitly argues
against); it is a computed comparison between what was claimed and what is actually true.

The one genuinely hard part of this problem is that **a vendor's payout address changing is
simultaneously the exact fraud signal *and* something that happens completely legitimately** —
vendors really do change banks. A system that hard-refuses every payout-address change is unusable in
practice (it would refuse real bank changes as often as fraud); a system that ignores payout-address
changes misses the actual attack. Bonded's answer is `Premise.holdOnMismatch`: a specific premise can
be marked so that a mismatch produces `HELD_FOR_STEPUP` (a mandatory fresh human/World ID check)
instead of a hard `REFUSED`. Everything else that's wrong — a suspended vendor, an invoice amount that
disagrees with the vendor-master record by more than a small tolerance — still hard-refuses, because
there is no legitimate story for those being wrong.

**The one-sentence pitch.** Before an autonomous AP agent pays a vendor invoice, Bonded independently
re-derives the vendor's true payout address, invoice amount, and account status from a vendor-master
source of truth, and turns any mismatch into a `CLEARED` / `REFUSED` / `HELD_FOR_STEPUP` verdict with
the exact claimed-vs-derived evidence attached — never a bare claim, and never a rubber-stamp button.

**Why Sui + Intercepta + World map onto this, specifically:**
- **Sui** is the settlement and audit-trail layer: a `Verdict` is an on-chain *object*, not a boolean
  flag in a database, and `settle`/`settle_with_stepup` *consume* it — the replay guard is structural
  (there is nothing left to check once the object is gone), not a flag someone forgot to set.
- **Intercepta** is the one live, real-time payment-risk screening call in the stack — the piece that
  answers "is the payee this invoice claims to be independently known to be bad," as opposed to "does
  it match our own records." It screens the payee's claimed EVM identity, before the payout-address
  hold, so a sanctioned payee is refused rather than held for a human.
- **World (ID for Agents)** is the fresh-human-presence check for exactly the moment `holdOnMismatch`
  fires — proof that a live human, not a replayed session or a compromised backend, is the one clearing
  the hold.

---

## 2. Architecture / repository layout

The real current tree (read directly, not guessed):

```
packages/
  seam/               Shared types (Proposal, Verdict, ReasonCode, PolicyArtifact, Premise) + fixed-point money math
  enforcer/           The refusal/hold decision engine — enforce(), five steps, zero chain/adapter dependency
  dispatcher/         Routes a policy's premise to the adapter that owns it; canonicalHash/computeLogRef; createEnforceDeps;
                      bindClaimArgs; failClosedTable
  issuer-oracle/      Vendor-master truth: disclosed fixture (default) or Xero (sources/xero.ts); the bank-change change log;
                      the older ticket/ecomm fixtures (kept, demoted)
  sui-settlement/     Real Sui settlement for a verdict: settleCleared, settleWithStepUp, commitPolicy, readPolicyHash, readVaultSpent
  intercepta-adapter/ Live Intercepta (Web3 Antivirus) HTTP client + the resolvePremise adapter side
  world-agents/       World ID for Agents OIDC step-up flow + the proposal-scoped step-up gate
  villain-corpus/     The spoofed-invoice BEC demo artifact + three real, no-mock enforce() outcomes
  mcp-server/         The MCP plugin wrapper — one tool, bonded_verify_invoice_payment (repo's first bin)
  attack-corpus/      Frozen, protected, unrelated historical artifact — never touched, never referenced further here
move/
  sources/
    bonded_vault.move      Verdict/StepUpApproval/Vault<phantom T>, mint/settle/settle_with_stepup
    bonded_registry.move   BondedRegistry, Table<address, vector<u8>>, commit_policy
  tests/                   12 Move unit tests
  DEPLOYMENTS.md           Public on-chain ids; abandoned + current deployments, both recorded
apps/
  console/            Invoice Inbox demo app (Next.js) — lib/enforce-deps.ts is its one composition point;
                      lib/ap-policy.ts (the one AP-agent policy); lib/payment.ts (verdict → Sui payout);
                      lib/settlement-ledger.ts (settle-once)
docs/
  THREATMODEL.md      What is/isn't built, dated scope-cut log (CLAUDE.md rule 6)
  VERIFY_FINDINGS.md  Primary-source [VERIFY] research for every sponsor API
  reference/          Crawled reference docs (Intercepta, Sui SDK, World ID)
FEEDBACK/
  intercepta.md, sui.md, world.md   Real, dated build friction, written as it happened
```

Every package under `packages/` except `attack-corpus` is npm-publish-shaped (`exports`/`main`/
`types`/`files` in its `package.json`), just `"private": true` — this is deliberate (see §7, Delivery).

---

## 3. The seam (`packages/seam`)

Zero runtime dependencies, by design — this package compiles before anything else in the repo and is
never allowed to depend on a chain SDK or an adapter package.

**`src/types.ts`** (real, current shapes):

```ts
export type Address = `0x${string}`;
export type Hash32 = `0x${string}`;
export type PremiseOp = 'gte' | 'lte' | 'eq' | 'older_than' | 'younger_than';

export interface Premise {
  id: string;
  schema: string;          // e.g. 'issuer-oracle-vendors' | 'intercepta-risk' — deliberately a plain string
  field: string;            // dot-path, e.g. 'vendor.payoutAddress'
  op: PremiseOp;
  value: string;            // always string-encoded — never parsed as a float
  toleranceBps?: number;
  holdOnMismatch?: boolean; // On mismatch, HELD_FOR_STEPUP instead of a hard REFUSE. Default false.
  args?: string[];          // Ordered subject args the dispatcher passes to the adapter's field fn.
}

export interface Proposal {
  id: Hash32;
  agent: Address;
  action: { kind: string; target: Address; calldata: `0x${string}`; valueUSDC: string };
  premises: Array<{ premiseId: string; claimedValue: string }>;
  createdAt: number;
}

export enum ReasonCode {
  OK = 0,
  PREMISE_MISMATCH = 1,
  PREMISE_UNRESOLVABLE = 2,
  POLICY_FORBIDDEN_ACTION = 3,
  BUDGET_EXCEEDED = 4,
  STALE_POLICY = 5,
  IRREVERSIBLE_UNCONFIRMED = 6,
  PREMISE_HELD_FOR_REVIEW = 7,   // added for the B2B pivot
}

export interface Verdict {
  proposalHash: Hash32;
  policyHash: Hash32;
  outcome: 0 | 1 | 2;   // 0 CLEARED, 1 REFUSED, 2 HELD_FOR_STEPUP
  reasonCode: ReasonCode;
  blockChecked: bigint;
  logRef: Hash32;
}

export interface PolicyArtifact {
  version: number;
  budget: { asset: 'USDC'; period: string; max: string };
  premises: Premise[];
  forbid: string[];
  irreversibleAboveUSDC: string;
}
```

**`src/money.ts`** — 6-decimal fixed-point money math, and *only* this:

```ts
export const USDC_DECIMALS = 6n;
export const USDC_SCALE = 10n ** USDC_DECIMALS;
export function bpsWithinTolerance(claimed: bigint, derived: bigint, toleranceBps: number): boolean
```

`bpsWithinTolerance` throws on a non-bigint, a negative amount, a non-integer `toleranceBps`, or a
`toleranceBps` outside `0..10000` — it never silently coerces. This is the one file CLAUDE.md rule 2
names explicitly, because this project's own history had exactly one silent float-money bug, and it
lived here. The Hostage Protocol's stake-multiplier math (`riskToStakeMultiplierBps`,
`requiredStake`, etc.) does **not** exist in this codebase — it was deleted, not deprecated, when the
project pivoted away from the stake/bond framing.

**Tests:** 20 (`money.test.ts` + `types.test.ts`, 2 suites), all passing.

---

## 4. The enforcer (`packages/enforcer`)

`enforce(proposal, policy, onchainPolicyHash, deps): Promise<Verdict>` — the five-step decision loop,
with zero chain dependency and zero adapter dependency of its own. Everything it needs from the
outside world is dependency-injected via `EnforceDeps`:

```ts
export interface EnforceDeps {
  resolvePremise(def: Premise, at: bigint): Promise<bigint | string | null>;
  getCheckpoint(): Promise<bigint>;
  sumRecentSpend(agent: Address, period: string): Promise<bigint>;
  logMismatch(proposalId: Hash32, premiseId: string, claimedValue: string, derivedValue: string): Promise<void>;
  canonicalHash(policy: PolicyArtifact): Hash32;
  computeLogRef(entry: LogRefInput): Hash32;
}
```

The five steps, in order:

1. **Stale-policy check.** `deps.canonicalHash(policy) !== onchainPolicyHash` → `REFUSED` /
   `STALE_POLICY`, checked before anything else, with `blockChecked = 0n` (no checkpoint was ever
   pinned for a verdict that never got this far).
2. **Forbidden-action check.** `policy.forbid.includes(proposal.action.kind)` → `REFUSED` /
   `POLICY_FORBIDDEN_ACTION`. Cheapest check second, so an action that was never going to be allowed
   never triggers a checkpoint fetch or a premise resolution below this line.
3. **Premise resolution**, against exactly one pinned checkpoint (`deps.getCheckpoint()`, called at
   most once per `enforce()` call) — pinning once closes the race window a per-premise "now" would
   open. For each claim: if the premise definition is missing, or `resolvePremise` returns `null`,
   → `REFUSED` / `PREMISE_UNRESOLVABLE`. Otherwise `evaluatePremise` compares the raw claimed string
   against the derived value (see the `holdOnMismatch` mechanism below).
4. **Budget check.** `spentSoFar + requested > maxUSDC` → `REFUSED` / `BUDGET_EXCEEDED`. Exactly equal
   to the max passes.
5. **Irreversible threshold.** `requested > irreversibleAboveUSDC` → `HELD_FOR_STEPUP` /
   `IRREVERSIBLE_UNCONFIRMED`. Exactly equal to the threshold clears.

Anything that reaches the end of all five steps is `CLEARED` / `OK`.

### The `holdOnMismatch` mechanism, explained

`enforce.ts`'s step-3 loop passes the proposal's raw claimed string straight through to
`evaluatePremise` — it does **not** pre-parse it as a `bigint`, because a categorical premise (e.g.
`vendor.status: 'active'`) has a claimed value like `"active"`, and `BigInt("active")` throws.
`tolerance.ts`'s `evaluatePremise(def, claimedRaw, derived)` is gated on `derived`'s runtime type: if
`derived` is a `string`, only `op: 'eq'` is valid (any other op throws a `TypeError` naming the
offending op/field — a categorical field has no meaningful ordering); if `derived` is a `bigint`, the
existing `gte`/`lte`/`older_than`/`younger_than`/`eq` (via `bpsWithinTolerance`) logic runs unchanged.

When a premise fails this comparison, `enforce.ts` does exactly one of two things:

```ts
return def.holdOnMismatch
  ? hold(proposal, policyHash, ReasonCode.PREMISE_HELD_FOR_REVIEW, blockChecked, deps.computeLogRef)
  : refuse(proposal, policyHash, ReasonCode.PREMISE_MISMATCH, blockChecked, deps.computeLogRef);
```

**Why this exists, stated plainly:** a vendor's payout address changing is *simultaneously* the actual
fraud signal and something that happens legitimately (vendors do change banks). A blanket refuse on
every payout-address mismatch would be unusable in practice — it would block real, benign bank
changes as hard as it blocks fraud. Routing this one specific mismatch to `HELD_FOR_STEPUP` instead
sends it to a mandatory fresh human/World-ID check rather than an automatic kill. An invoice-amount
mismatch beyond tolerance, or a suspended-vendor status mismatch, has no equivalent "maybe legitimate"
story — those premises leave `holdOnMismatch` unset and hard-refuse, by design (see the villain-corpus
scenarios in §8).

Either way, `deps.logMismatch` is awaited *before* the verdict is returned, and it is always given
*both* the claimed and derived values — CLAUDE.md rule 5 ("every refusal or hold carries the actual
re-derived value next to the claimed one") is enforced structurally here, not left to callers.

**Tests:** 41 (`budget.test.ts`, `tolerance.test.ts`, `enforce.test.ts`; 3 suites), all passing —
covering the hold/refuse branch split, step ordering (an earlier hard mismatch wins over a later
`holdOnMismatch` one), the categorical `'eq'`-only restriction, and the pre-existing bigint-comparison
boundary values.

---

## 5. The dispatcher (`packages/dispatcher`)

Before this package existed, `enforce.ts`'s own doc comment already promised that
`EnforceDeps.resolvePremise` "routes to whichever adapter owns `def.schema`" — but nothing in the repo
actually implemented that router; every `enforce()` caller was a unit test with a hand-rolled mock.
`@bonded/dispatcher` is that router, plus the one other piece `EnforceDeps` needs that has nowhere
else to live: a real (non-test-stub) `canonicalHash`/`computeLogRef`.

```ts
export interface SchemaFieldTable { fields: Record<string, (...args: string[]) => Promise<bigint | string | null>> }
export type SchemaRegistry = Record<string, SchemaFieldTable>;
export function createResolvePremise(registry: SchemaRegistry): EnforceDeps['resolvePremise']
export function canonicalHash(policy: PolicyArtifact): Hash32
export function computeLogRef(entry: LogRefInput): Hash32
export function createEnforceDeps(registry: SchemaRegistry, extras: {
  getCheckpoint, sumRecentSpend, logMismatch
}): EnforceDeps
```

`createResolvePremise` looks up `registry[def.schema]`, then `table.fields[def.field]`; either miss
resolves `null` (the enforcer's existing "unresolvable" contract), otherwise it calls the field
function with `def.args ?? []` spread in order.

Two opt-in wrappers were added for the one-policy-per-agent console:

```ts
export function bindClaimArgs(resolvePremise: EnforceDeps['resolvePremise'], proposal: Pick<Proposal, 'premises'>): EnforceDeps['resolvePremise']
export function failClosedTable(schema: string, table: SchemaFieldTable, onFailure: (f: ResolveFailure) => void): SchemaFieldTable
```

- `bindClaimArgs` replaces a `claim:<premiseId>` arg with that proposal's claimed value for the named
  premise. `BondedRegistry` holds one policy hash per agent, so a committed policy can't hard-code a
  per-invoice screening subject; this lets it say "screen whatever payee identity this proposal
  claims." No claim, or more than one, resolves `null` without calling the adapter.
- `failClosedTable` wraps every field function of a table so a throw becomes `null` (→ `REFUSED` /
  `PREMISE_UNRESOLVABLE`), after handing the error to `onFailure`. `@bonded/intercepta-adapter`
  deliberately throws on a missing key or HTTP error; the console and the MCP tool wrap
  `intercepta-risk` with this and surface the errors as `screeningErrors`. Nothing is dropped silently
  and no screen result is invented.

**Why this package owns `canonicalHash`, and why every caller must use this exact implementation:**
`bonded_registry.move`'s `commit_policy` stores an opaque `vector<u8>` that Move compares only for
byte-equality — there is no on-chain-enforced hash scheme to conform to (confirmed by reading the
actual Move source). Since nothing external dictates the hash function, this package's own choice
(recursive key-sorting + bigint-tagging + `JSON.stringify` + sha256) is authoritative for the whole
repo. Every caller that needs its locally-computed policy hash to actually equal an on-chain
commitment (console, mcp-server, villain-corpus) imports and calls this exact function — two
"reasonable" canonicalizations of the same object produce different bytes and would trip
`STALE_POLICY` spuriously, or worse, silently agree on one shape and silently diverge on the next.

**Tests:** 21, all passing, including a real end-to-end test wiring `issuerOracleVendors` (no mocks)
to prove the BEC mismatch resolves through the real router, not only through hand-rolled test doubles,
and tests that `failClosedTable` records every converted error.

---

## 6. The two truth sources

### 6a. Issuer-oracle (`packages/issuer-oracle`) — disclosed vendor-master stand-in

**Stated honestly, in the file itself, before anything else:** `vendor-fixture.ts` is "a controlled,
seeded reference service we run ourselves, standing in for what a real vendor-master/ERP system (SAP,
NetSuite, a bank's own beneficiary registry, etc.) would tell an AP-automation enforcer in
production. It is not a live feed from any real vendor-master or ERP system, and it is never described
as one anywhere in this codebase."

Four seeded vendors, ids stable across every downstream package:

| Vendor id | Status | Payout address | Invoice amount | Scenario |
|---|---|---|---|---|
| `vnd-acme-supplies` | `active` | old (>1yr) `payoutAddressLastChangedAt` | $1,250.00 | Clean — `CLEARED`/`OK`, paid automatically |
| `vnd-globex-freight` | `active` | changed **3 days** before baseline (a real, legitimate bank change) | $8,450.00 | Both the spoofed invoice and a genuine bank change are claimed against this vendor id — this fixture states only the truth |
| `vnd-suspended-corp` | `suspended` | n/a to the scenario | $4,200.00 | Hard-refuse regardless of what's claimed |
| `vnd-halcyon-machining` | `active` | old | $15,000.00 | Every fact matches, but over the $10,000 irreversible threshold — `HELD_FOR_STEPUP` / `IRREVERSIBLE_UNCONFIRMED` |

```ts
export interface VendorTruth {
  vendorId: string; legalName: string; payoutAddress: `0x${string}`;
  invoiceAmountUSD: string; status: 'active' | 'suspended'; payoutAddressLastChangedAt: number;
  evmAddress: `0x${string}`;   // registered 20-byte EVM identity, for SCREENING, not settlement
}
export async function fetchVendorTruth(vendorId: string): Promise<VendorTruth | null>
export function createVendorSource(env?: NodeJS.ProcessEnv, options?: { changeLogPath?: string }): VendorSource
```

`evmAddress` exists because Intercepta screens EVM addresses and every `payoutAddress` is a 32-byte
Sui address (§6b). The seeded values are synthetic (first 20 bytes of
`sha256("bonded-synthetic-evm-identity:<vendorId>")`) and were checked absent from the OFAC SDN list
when chosen.

`issuerOracleVendors` (in `schemas.ts`) exposes `vendor.payoutAddress` / `vendor.status` /
`vendor.evmAddress` as plain strings (categorical, compared via `op: 'eq'`), and
`vendor.invoiceAmountUSD` / `vendor.payoutAddressLastChangedAt` as `bigint` (money/timestamp, never a
native `number`). `vendorTruthFields(source)` builds the same table over any `VendorSource`.

**Source selection.** `createVendorSource` reads `VENDOR_MASTER_SOURCE=fixture|xero`; `fixture` is the
default.

- **Fixture mode** optionally overlays an append-only change log
  (`.data/vendor-master-changes.json`, `vendor-master-changes.ts`) holding World-approved bank changes.
  Each entry records the World `sub`, `authTimeMs` and `proposalHash`, and is compare-and-set against
  the current address under a file lock. It is part of the disclosed stand-in, not an ERP.
- **Xero mode** (`sources/xero.ts`) reads a real Xero organisation over the Accounting API, using a
  Custom Connection (client-credentials; free against the Xero Demo Company). Mapping: `vendorId` ←
  `ContactNumber`; `payoutAddress` and `evmAddress` ← the supplier's `BankAccountDetails` in the
  format `bonded:v1;sui=0x<64 hex>;evm=0x<40 hex>` (Xero has no wallet field, and bank details are the
  field a BEC attacker asks AP to change); `status` ← `ContactStatus` (ARCHIVED / GDPRREQUEST →
  `suspended`); `invoiceAmountUSD` ← the latest AUTHORISED USD ACCPAY bill's `Total`, via integer
  string math. Xero has no bank-detail-change timestamp, so `payoutAddressLastChangedAt` ←
  `UpdatedDateUTC` (last contact update), which errs toward more holds. Anything that doesn't fit
  throws `XeroDataError`; nothing falls back to the fixture. `xero:setup` seeds the Demo Company from
  the fixture and reads it back; `xero:check` reads it back only. Re-running `xero:setup` writes the
  fixture values again, which reverts an approved bank change. **It has not run live; it needs Xero
  credentials.**
- `createVendorMasterBankChangeWriter` (`sources/bank-change.ts`) writes an approved bank change to
  whichever source is active (Xero `BankAccountDetails`, or the fixture change log).

The older `tickets-fixture.ts` (`evt-tokyo-showcase`, `evt-osaka-arena`, `evt-cancelled-fest`) and
`ecomm-fixture.ts` (`prod-camera-x200`, `prod-headphones-acme`, `prod-sneakers-zeta`) — from the
scalper-ticket and bait-and-switch-checkout villain scenarios of the earlier, superseded designs —
remain in the package, tested, and exported (`issuerOracleTickets`, `issuerOracleEcomm`). They are
"also demonstrated," not the primary narrative and not deleted.

**Tests:** 78 across 3 suites (`issuer-oracle.test.ts`, `vendor-master-changes.test.ts`,
`xero.test.ts`), all passing. The Xero tests exercise the mapping and error paths without a live Xero
call.

### 6b. Intercepta (`packages/intercepta-adapter`) — real, live risk API

This is the one adapter with **zero disclosure caveats about being a fixture** — every call is a real
HTTP request to `https://api.web3antivirus.io/api/public/v2/extension`, with `cache: 'no-store'` on
every fetch, and no fallback value on any failure path (a missing key, non-2xx, timeout, non-JSON, or
unexpected shape all throw). Every response's exact bytes are sha256'd and written to
`.data/intercepta/<sha256>.json` before the body is interpreted, so any downstream decision can cite
the precise response that justified it.

```ts
scanAddress(address, 'quick-scan' | 'toxic-score', options?) → { result: ToxicScoreResponse; evidence: ScanEvidence }
scanToken(tokenAddress, chainId, options?) → { result: TokenRiskAnalysisResponse; evidence: ScanEvidence }
scanMessage(payload, options?) → { result: SignatureAnalysisResponse; evidence: ScanEvidence }
```

**What gets screened: the payee's claimed EVM identity, not the Sui payout address.** Intercepta's
address-scan endpoints take "an ETH address/ENS" (the documented parameter description) — a 20-byte
EVM address or a lowercase ENS name. `parseScreeningSubject` in `client.ts` still **rejects** a 32-byte
Sui address before any network call. So each invoice claims an EVM identity for the payee, and that
is what is screened. The console's policy (`apps/console/lib/ap-policy.ts`), per screened vendor, in
order:

1. `intercepta-risk` / `payment.payTo.traitCount lte 0`, subject `claim:p-<vendor>-evm-identity`
   (bound by `bindClaimArgs`, §5). `traitCount` is the length of Deep Scan's documented `traits[]`;
   any trait (`sanction_address`, `known_scammer`, `mixer_transfers`, ...) is a hard `REFUSED`. No
   `toxicScore` threshold is set, since its range is undocumented.
2. `vendor.status eq`, hard refuse.
3. `vendor.evmAddress eq`, hard refuse: the claimed identity must equal the registered one.
4. `vendor.payoutAddress eq`, `holdOnMismatch: true`, last — so a hold is only reached after every hard
   check passed, and a sanctioned payee is refused, never held for a human who might approve it.

The spoofed invoice claims a real OFAC-listed address: Lazarus Group
`0x098b716b8aaf21512996dc57eb0615e2383e2f96`, SDN entry 27307, program DPRK3, added 2022-04-14 (Tornado
Cash addresses were not used; OFAC delisted them on 2025-03-21). The screen is wrapped in
`failClosedTable`, so without `INTERCEPTA_API_KEY` these invoices are `REFUSED` /
`PREMISE_UNRESOLVABLE`, with the key error in `screeningErrors`. **The screen has not run live yet.**

**The remaining caveat:** the screen checks the identity the payee *claims*, not the Sui address the
money goes to. The link is asserted by the invoice, backed by premise 3 above, and settlement always
pays the vendor master's Sui address, never the claim (§7). It is not a cryptographic proof that the
EVM identity controls the Sui address. See `sponsers.md`'s Intercepta section.

The adapter's `interceptaRisk` table exposes only the fields that are already numeric in Intercepta's
own documented schema (`toxicScore`, trait/detector counts, token `riskScore`) as `bigint`. Categorical fields
(`riskLevel`, `category`, `trust`, `action`, `riskGroup`) are deliberately **not** exposed through this
bigint-only surface — inventing an ordinal encoding for a string enum (deciding `high` = `3n`, say)
would be exactly the kind of guessed severity threshold this project's `[VERIFY]` discipline forbids.
They remain reachable directly from the parsed response objects for a UI or a future premise-op
extension.

**Tests:** 46, all passing — covering strict response-shape validation (exact-key enforcement on the
fully-confirmed `ToxicScoreShortResponseV2` schema, required-key-only on the partially-confirmed token/
message schemas), the Sui-address rejection, and the no-cache/no-fallback discipline.

---

## 7. Settlement (`move/`)

**Package id:** `0xf3d914b39722e1c6c3f0e274d088623c0e050d3125b8f658d48b94498efbf57a` (Sui testnet,
protocol version 137) — the current, non-abandoned Commerce Edition deployment. (A prior "Hostage
Protocol" `bond_vault` package at `0x990acf4456f98cedde25ba5c2b6e32103386bf8391c4ff3d2c32709e35c50d43`
is explicitly abandoned and left immutable on testnet; nothing in this build calls it. Both are
recorded, dated, in `move/DEPLOYMENTS.md` — nothing is silently dropped from that file.)

| Object | Id |
|---|---|
| UpgradeCap | `0x0cd4a49fcd88aedca2f27ad3185a4cc5d6d185a1039764f82f33959136afea01` |
| EnforcerCap | `0x60302c2c5682c685daf794b1acf0114bbcfea1d5873066d2860654b1ea5f375d` |
| Vault\<USDSUI\> (shared) | `0x1c828f5496dfb9200c50f7fcc932cb0edb477265b58978036f4b77018e4dd433` |
| BondedRegistry (shared) | `0x107a77efbd5ab5ba91d4ec1104205e254a14365484d694ec72a615bea2b912a5` |
| Settlement coin `T` | `0x832f93729a8b1dfe9dd8067536dfa35231cf019f9401afe04a398df6d18c54cb::usdsui::USDSUI` (6 decimals) |

**`bonded::bonded_vault`** — `EnforcerCap` (minted once at `init`, to the publisher; there is no other
way to obtain one, and no address check anywhere downstream — whoever holds this object structurally
*is* the enforcer). `Verdict` (`proposal_hash`, `policy_hash`, `outcome: u8`, `reason_code: u16`,
`value_usdc: u64`) is an **object**, not a mapping entry: `mint_verdict(_cap: &EnforcerCap, ...)`
requires the cap to produce one, and `settle`/`settle_with_stepup` **consume** it —
`object::delete(id)` runs unconditionally as the first line of both functions. This is the entire
replay guard: there is no boolean flag to forget to check, because after settlement there is nothing
left on-chain to check against. `StepUpApproval` (`proposal_hash`) is minted by the same `EnforcerCap`
— a documented choice not to introduce a second capability type, since in this codebase the enforcer
is the only component that ever turns a real World fresh-verification result into an on-chain object.
`settle_with_stepup` requires **both** a `HELD_FOR_STEPUP` `Verdict` and a `StepUpApproval` for the
*same* `proposal_hash` (asserted, `EProposalHashMismatch` otherwise) — two objects consumed, never one
signature-shaped flag. `settle` itself aborts (`EHeldForStepupNotSettleableDirectly`) if handed a
`HELD_FOR_STEPUP` verdict directly; that path must go through `settle_with_stepup`.

**`bonded::bonded_registry`** — `BondedRegistry { current_policy_hash: Table<address, vector<u8>> }`.
`commit_policy(_cap: &EnforcerCap, registry, agent, policy_hash)` is the **only** write path, and it
always overwrites forward — there is no rollback function anywhere in the module. This is
`enforce()`'s step-1 stale-policy check's real on-chain source of truth: an `onchainPolicyHash` that
doesn't match what an agent last committed here fails closed.

**Live smoke test, confirmed on real testnet transactions (not just `test_scenario`):** a `CLEARED`
verdict minted for 1,000,000 USDSUI base units and settled against the shared `Vault<USDSUI>` in one
PTB (tx `CS9mZRfvCdKptwBFypyYsTC4DP2V2whynXz8PhghLuX6`) — the recipient's new coin object confirmed to
hold exactly `balance: "1000000"`, and `spent_this_period` moved `0 → 1000000` in the same call. A
`HELD_FOR_STEPUP` verdict minted and dry-run directly into `settle` (skipping `settle_with_stepup`)
aborted exactly as designed, at zero gas cost, with abort code `0`
(`EHeldForStepupNotSettleableDirectly`).

**Move test suite:** 12 tests, run via `sui move test` inside `move/`, all passing — covering
cap-gating (`enforcer_cap_holder_can_mint_a_verdict`, `attacker_without_the_cap_cannot_obtain_one`,
`attacker_without_the_cap_cannot_commit_a_policy`), the settle/refuse/held branches, the
`settle_with_stepup` success and proposal-hash-mismatch-abort paths, replay
(`a_settled_verdict_object_id_cannot_be_fetched_again`), and the registry's forward-only-overwrite
behavior.

### 7a. Automatic settlement (`packages/sui-settlement`, `apps/console/lib/payment.ts`)

`@bonded/sui-settlement` submits the real settlement for an `enforce()` verdict by shelling out to
`sui client ptb ... --json` (signed by the Sui CLI keystore; TypeScript never reads key bytes) and
reads every result back over gRPC. It exports `settleCleared` (mint a `CLEARED` verdict + `settle`,
one PTB), `settleWithStepUp` (verdict + `StepUpApproval` + `settle_with_stepup`; refuses hand-built,
uncertified, denied, stale or wrong-proposal approvals before any CLI call), `commitPolicy`,
`readPolicyHash` and `readVaultSpent`. The recipient always comes from `deriveVendorRecipient`, which
re-derives it from the vendor master; the claim's address is never paid.

The console closes the loop. `POST /api/enforce` reads `onchainPolicyHash` from `BondedRegistry`
(never recomputed locally; a failed read or missing hash is a visible `OnchainPolicyError`), uses the
vault's real `spent_this_period` as `sumRecentSpend`, runs `enforce()`, and on `CLEARED` calls
`settleCleared`. A settle-once ledger (`.data/console/settlements.json`, keyed by `proposalHash`) makes
each invoice pay at most once: the on-chain `Verdict` is deleted on settle, but nothing on-chain stops
a *fresh* verdict for an already-paid proposal. A settlement that fails where a transaction may
already have been submitted is recorded `unknown` and left for manual review, never retried
automatically.

**One AP-agent policy.** `BondedRegistry` holds one hash per agent, so every console invoice is
enforced against one committed `PolicyArtifact` (`ap-policy.ts`): per-vendor premise ids, no vendor
fact embedded in any premise `value` (so a bank change doesn't change the hash), `irreversibleAboveUSDC`
$10,000, budget max $100,000 with period labelled `vault-lifetime`, because `spent_this_period` never
resets on-chain.

**Live, on testnet** (every digest in `move/DEPLOYMENTS.md`'s auto-settlement sections): the one-AP
policy committed (`8AVk9pGcPovuftPwsHqkiQUCxcTHp2uxZFnQw8LxzVh`); the vault topped up by minting
USDSUI through its `TreasuryCap` via `0x2::coin::mint` + `fund_vault`; and acme paid through the
console route, digest `BkuSQ6nhyEXBXvGs9X3kiX3WVgTkPZ9HAkEdNgDqwP69` (1,250,000,000 base units to
`0x4d5a…d3e0`). A second identical POST returned the same digest with `alreadySettled: true` and paid
nothing. **`settleWithStepUp` has not run live; it needs World credentials.**

**Tests (`@bonded/sui-settlement`):** 58 across 4 suites, all passing, with no live chain call.

---

## 8. Identity / step-up (`packages/world-agents`)

Server-side only OIDC relying-party flow against World's live sandbox
(`https://sandbox.auth.world.org`), re-probed live on 2026-09-26 immediately before this file was
written: issuer, four endpoints (`authorization_endpoint`, `token_endpoint`, `jwks_uri`,
`device_authorization_endpoint`), single scope `openid`, PKCE S256, RS256 ID tokens, no
`userinfo_endpoint`, `acr_values_supported: ["https://world.org/oidc/acr/orb-v3"]` — zero drift from
the documented discovery contract.

**When it fires:** `WorldStepUpFlow.initiateStepUp({ proposalHash, reason })` is called for exactly
one specific `proposalHash` — either an `IRREVERSIBLE_UNCONFIRMED` hold (step 5 of `enforce()`) or a
`PREMISE_HELD_FOR_REVIEW` hold (a `holdOnMismatch` premise, i.e. the payout-address-changed case).
Every request uses `max_age=0` ("require this transaction's own fresh World proof, even with an
existing browser session") — never a cached prior login.

**The denied/expired path:** `handleCallback(code, state)` returns one of three shapes:
`{ verified: true, sub, authTimeMs }`, `{ denied: true, reason }`, or `{ expired: true }`. Denial
reasons are typed and distinct: `access_denied`, `state_mismatch`, `nonce_mismatch`, `replayed_code`,
`token_exchange_failed`, `idp_unavailable` (5xx/429 — never treated as a verdict, since "HTTP 503
indicates temporary unavailability, never invalid identity"), `token_invalid`, `assurance_mismatch`
(`acr`/`amr` insufficient), `attempt_expired`/`token_expired`. `stepup-gate.ts`'s `decideStepUp` then
applies its own two additional policy checks on top of an already-`verified: true` result:
**freshness** (`STEPUP_FRESHNESS_WINDOW_MS = 5 * 60 * 1000` — matching the sandbox's own 5-minute
code/token lifetime, so a step-up approval never outlives the proof that justified it) and, only if
the caller opted in, `sub_mismatch` (an optional `boundSub` binding, off by default — this gate answers
"did a human freshly prove presence for *this* attempt," not "is it the *same* human as before").

Single-use enforcement (state lookup, code-hash replay, attempt TTL) happens in one atomic store
update **before** a code is ever sent to the token endpoint, so a duplicated callback can never reach
the IdP twice and a replayed/leaked code is refused without a network call at all.

**What an approval does in the console** (`apps/console/lib/payment.ts`'s `completeStepUp`, which
re-derives the verdict first and certifies the approval with `approveStepUpForSettlement` over the
real `decideStepUp`):

- `IRREVERSIBLE_UNCONFIRMED` (the $15,000 halcyon invoice) → `settleWithStepUp`, paying the address on
  file.
- `PREMISE_HELD_FOR_REVIEW` on the payout premise (a bank change) → the approval does **not** pay the
  claimed address. It writes the confirmed new address to the vendor master (Xero
  `BankAccountDetails`, or the fixture change log), re-runs `enforce()`, and the now-matching invoice
  clears and pays the updated truth (or, if it's also over the threshold, settles with the same fresh
  approval).

**None of this has run live: there are no World sandbox credentials yet.** Without them
`/api/stepup` answers a visible 501 naming the three missing variables.

**Tests:** 59, across `flow.test.ts`, `stepup-gate.test.ts`, and `world-jwks.test.ts` (the latter
fetches the *real* live JWKS, reads its real key id, and confirms `verifyIdToken` rejects a token
signed with a different key under that same real `kid` — exercising jose's actual cryptographic check
against real key material, never a fabricated World-signed token).

---

## 9. The demo

### 9a. Villain-corpus (`packages/villain-corpus`)

`site/spoofed-invoice.html` is a real, static, self-disclosing artifact: a "URGENT — Updated
Remittance Details" email impersonating `Globex Freight & Logistics Inc.` (the seeded
`vnd-globex-freight` fixture record), sent from a lookalike domain
(`globex-freight-payments.com`), claiming a fraudulent payout address
(`0xe218026a7210d04d19e4cc677f1c459c5ff353df6915b44e085397fdbdb89187`) embedded in the markup as
`#fraudulent-payout-address[data-address]`, and a claimed payee EVM identity embedded as
`#claimed-evm-identity[data-address]`: the real OFAC-listed Lazarus Group address
`0x098b716b8aaf21512996dc57eb0615e2383e2f96` (SDN entry 27307, DPRK3, added 2022-04-14), explained
on the page. The page's own red-flags section and its "$3.04 billion"
context box cite the same real IC3 figure as this document. A disclosure banner at the top states
plainly that this is a synthetic BEC test artifact, not a real invoice.

`harness/naive-ap-agent.ts` is a small, deliberately simple stand-in for a naive, pre-Bonded AP agent:
it reads the claimed fraudulent address straight out of the HTML (via regex against the real markup,
not a separately hand-typed constant) and proposes paying it, unconditionally, with zero verification.

`harness/run.ts` feeds that naive proposal through the **real** `enforce()` (via the real
`@bonded/dispatcher` router, against the real `@bonded/issuer-oracle` vendor fixture, no mocks
anywhere) in three scenarios:

| # | Vendor | What's claimed | Real outcome |
|---|---|---|---|
| 1 | `vnd-globex-freight` | The fraudulent address read off the spoofed page | `HELD_FOR_STEPUP` / `PREMISE_HELD_FOR_REVIEW` |
| 2 | `vnd-suspended-corp` | `active` status (the vendor is actually `suspended`) | `REFUSED` / `PREMISE_MISMATCH` |
| 3 | `vnd-acme-supplies` | The correct, matching payout address and status | `CLEARED` / `OK` |

The three core scenarios are key-free by design (no screen premise), so scenario 1 shows the
payout hold on its own. A key-gated fourth scenario (`runInterceptaScreenScenario`) runs the full
globex policy: it screens the EVM identity the spoofed page claims, first, and must `REFUSE`. Without
`INTERCEPTA_API_KEY` it records a visible "not run: missing key" status, never a silent skip. (This
replaced an earlier fourth scenario that screened the 32-byte Sui payout address and could never
succeed, because Intercepta's address endpoints reject anything that isn't a 20-byte EVM address or
ENS name.) The harness writes its own `packages/villain-corpus/results.json` (structurally similar to,
but entirely separate from, the frozen `packages/attack-corpus/results.json` — that package is never
touched).

**Tests:** 9, all passing — the three deterministic outcomes above, checks on the addresses embedded
in the page, and the key-gated scenario's fail-closed path, all with no live network call.

### 9b. Console (`apps/console`) — Invoice Inbox

A Next.js app whose one composition point, `lib/enforce-deps.ts`, wires the real
`@bonded/dispatcher`'s `createEnforceDeps` against the vendor master chosen by `createVendorSource`
(fixture plus change log, or Xero) and `intercepta-risk` wrapped in `failClosedTable`, with
`bindClaimArgs` binding screening subjects from each proposal. Every invoice is enforced against the
one committed AP-agent policy (`lib/ap-policy.ts`, §7a), with `onchainPolicyHash` read from
`BondedRegistry` and `sumRecentSpend` read from the vault. The spoofed invoice's claims are copied by
reading `spoofed-invoice.html` (a test fails on drift), not by importing `@bonded/villain-corpus`.

The five demo invoices (`inv-*`):

| Invoice | Claim | Outcome | Needs |
|---|---|---|---|
| `inv-acme-supplies` | correct | `CLEARED` → paid on Sui (live, digest `BkuSQ6nh…wP69`) | nothing |
| `inv-globex-spoofed` | fraudulent payout address + OFAC-listed EVM identity | `REFUSED` by the screen; fail-closed `REFUSED` / `PREMISE_UNRESOLVABLE` without a key | `INTERCEPTA_API_KEY` for the live screen |
| `inv-suspended-corp` | claims `active` | `REFUSED` / `PREMISE_MISMATCH` | nothing |
| `inv-globex-bank-change` | registered EVM identity + genuine new payout address | screen passes → `HELD` / `PREMISE_HELD_FOR_REVIEW` → World approval writes the new address to the vendor master → re-enforced, clears, pays | Intercepta + World keys |
| `inv-halcyon-machining` | correct, $15,000 | `HELD` / `IRREVERSIBLE_UNCONFIRMED` → World approval → `settleWithStepUp` | Intercepta + World keys |

Routes: `app/invoices/page.tsx` (the inbox), `app/api/enforce/route.ts` (`POST { invoiceId }` → the
agent proposing payment: runs the real `enforce()`, settles on `CLEARED`, and returns the `Verdict`,
the claimed/derived pair for **every** premise checked — CLAUDE.md rule 5 — plus `screeningErrors`
and the settlement status), `app/invoices/[id]/page.tsx` (the premise-diff table, outcome badge and
settlement), `app/stepup/page.tsx` + `app/api/stepup/route.ts` (thin wrappers over
`@bonded/world-agents`; the route never trusts a client-supplied proposal and re-derives the real
verdict before starting a World attempt; the callback goes to `completeStepUp`, §8).

**Known UX caveat:** opening an invoice detail page triggers the agent's `POST /api/enforce`, which
pays if the verdict is `CLEARED`. The payment is the agent's action (no human-approval button, per
CLAUDE.md rule 4), and the ledger stops a second payment, but viewing a page does trigger it.

Out of scope by design, stated in the composition file itself: browser-side Sui wallet signing (never
built, per CLAUDE.md rule 3), auth, multi-tenancy. `getCheckpoint` is a unix-seconds stand-in, not a
Sui checkpoint.

**Tests:** 24, all passing (another change to this suite was in progress in parallel when this was
counted, so the number may move).

---

## 10. Delivery / distribution

**SDK-first.** Every real package under `packages/` (except `attack-corpus`) already carries
`exports`/`main`/`types`/`files` in its `package.json` — it is publish-shaped today, just
`"private": true`. An AP platform's own backend calling `enforce(proposal, policy,
onchainPolicyHash, deps)` before executing a payment is the lowest-friction, most-believable
integration: no service to stand up, no vendor lock-in to a hosted API.

**`packages/mcp-server` — the plugin form.** The repo's first `bin` entry
(`bonded-mcp: ./dist/server.js`), a thin stdio MCP server (`@modelcontextprotocol/sdk@^1.30.1`,
`zod@^4.6.5`) exposing exactly one tool, `bonded_verify_invoice_payment`. It owns **no enforcement
logic of its own** — every decision comes from the same real `enforce()` → `@bonded/dispatcher` →
`@bonded/issuer-oracle` chain every other caller in this repo uses. Its policy shape hard-codes a
`vendor.status` premise (checked first, hard-refuse), a `vendor.payoutAddress` premise
(`holdOnMismatch: true`), and a `vendor.invoiceAmountUSD` premise (0.5% tolerance, hard-refuse beyond
that) — documented at length in `src/tools/verify-invoice-payment.ts`'s own header, including why each
choice was made. When the caller passes an optional `claimedPayeeEvmAddress`, a fourth premise
screens it through Intercepta (`payment.payTo.traitCount lte 0`, hard refuse, fail-closed via
`failClosedTable`), ordered after status and before the payout hold. Unlike the console policy, the
MCP tool has no separate registered-identity match premise. The MCP tool returns a verdict only; it
does not settle. Two integration paths are shown side by side in the package README: direct SDK usage
(`import { enforce } from '@bonded/enforcer'`, or even more directly `import { verifyInvoicePayment }
from '@bonded/mcp-server'`) versus adding it as an agent tool (`claude mcp add bonded-mcp -- node
./packages/mcp-server/dist/server.js`).

**A hosted, multi-tenant gateway is roadmap only — not built.** Named explicitly as such in
`docs/THREATMODEL.md`; nothing in this repo stands one up.

---

## 11. Testing matrix — real, observed counts

Re-run directly against this repository on 2026-09-26 for this revision (`pnpm --filter <name> test`
for every TypeScript package, `sui move test` inside `move/`). These are the actual numbers observed,
not carried over from an earlier document:

| Package | Test suites | Tests | Result |
|---|---|---|---|
| `@bonded/seam` | 2 | 20 | all passing |
| `@bonded/enforcer` | 3 | 41 | all passing |
| `@bonded/dispatcher` | 1 | 21 | all passing |
| `@bonded/issuer-oracle` | 3 | 78 | all passing |
| `@bonded/intercepta-adapter` | 1 | 46 | all passing |
| `@bonded/world-agents` | 3 | 59 | all passing |
| `@bonded/sui-settlement` | 4 | 58 | all passing |
| `@bonded/villain-corpus` | 1 | 9 | all passing |
| `@bonded/mcp-server` | 1 | 12 | all passing |
| `@bonded/console` | 1 | 24 | all passing (a parallel change to this suite was in progress; the count may move) |
| `move/` (`sui move test`) | — | 12 | all passing |
| **Total** | | **368 TS tests + 12 Move tests = 380** | |

Every one of these suites runs with no live sponsor API key, no Xero credentials and no chain write
(Intercepta's client is unit-tested against strict response-shape validation with no live call, and
the key-free fail-closed paths are tested directly; the Xero tests use an injected fetch, and the
Sui settlement tests cover argument building, config and step-up gating without submitting anything,
with the live proof recorded in `move/DEPLOYMENTS.md` instead; the
villain-corpus harness's live-Intercepta scenario only runs via `tsx harness/run.ts` with a key).
World's tests do hit the real sandbox JWKS/discovery endpoints read-only. That sandbox has been slow
from this machine (around 3–11 s against a 10 s timeout), so an occasional world-agents timeout is a
network issue, not a code failure; on this run all 59 passed.

---

## 12. Sponsor qualification (brief — see `sponsers.md` for full detail)

| Sponsor | Real, live integration | Package(s) |
|---|---|---|
| **Sui** | On-chain settlement objects, deployed on testnet; object-capability replay guard; automatic payout from the console on `CLEARED`, run live (acme, `BkuSQ6nh…wP69`) | `move/`, package `0xf3d914b3…bf57a`; `packages/sui-settlement`; `apps/console/lib/payment.ts` |
| **Intercepta** | Live Web3 Antivirus HTTP client, no mocks, no cache, sha256 evidence storage; screens the payee's claimed EVM identity, fail-closed. **Not yet run live (no key)** | `packages/intercepta-adapter`; `apps/console/lib/ap-policy.ts` |
| **World** | Live OIDC sandbox relying-party flow, real JWKS verification, proposal-scoped step-up that gates `settleWithStepUp` and bank-change approval. **Not yet run end to end (no client credentials)** | `packages/world-agents`; `apps/console/lib/payment.ts` |

See `sponsers.md` for what each sponsor is, why it was chosen, exactly where it's implemented, what
would break without it, and — for Intercepta specifically — what the claimed-identity screen does and
doesn't prove.

---

## 13. Honest disclosures / what's not built

Stated here, consistent with `docs/THREATMODEL.md`'s own dated entries — nothing below is a gap
discovered by a reviewer that this document tries to hide:

- **None of the Intercepta, World or Xero flows has run live.** Each needs keys (listed in
  `README.md`): `INTERCEPTA_API_KEY`; `WORLD_SANDBOX_CLIENT_ID` / `_SECRET` / `WORLD_REDIRECT_URI`;
  `VENDOR_MASTER_SOURCE=xero` with `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`. Until then the globex
  bank-change and halcyon invoices can't complete, `settleWithStepUp` hasn't run on-chain, and whether
  Deep Scan actually returns a trait for the Lazarus address is unconfirmed.
- **The vendor master is still the disclosed, controlled fixture by default**, not a live ERP feed. Its
  own file header says so. The Xero connector is the production-shaped swap, behind the same
  `VendorSource` signature, but is opt-in and unrun.
- **Intercepta screens the identity the payee claims, not the Sui address the money goes to.** The
  link is asserted by the invoice, backed by a hard-refuse premise that the claimed identity equals the
  vendor's registered one; settlement always pays the vendor-master address. It is not a
  cryptographic link between the EVM identity and the Sui address.
- **The World identity isn't linked to a Sui account.** The step-up proves a fresh human for one
  proposal; it doesn't bind that human to an on-chain address.
- **The budget is vault-lifetime, not periodic**, because `spent_this_period` never resets on-chain.
- **Opening an invoice detail page triggers the agent's POST**, which pays if `CLEARED`. A settlement
  whose outcome is unknown is left for manual review, never retried automatically.
- **`getCheckpoint()` is a unix-timestamp stand-in, not a Sui checkpoint**, in both the console and
  the MCP tool; `Verdict.blockChecked` is never shown as a checkpoint.
- **`site/spoofed-invoice.html` is not hosted anywhere public yet.** It is a complete, real static
  file, referenced by its own provenance footer as "not deployed anywhere yet" — a Vercel/GitHub Pages
  deployment is a real next step, not done.
- **There is no natural-language "intent → PolicyArtifact" compiler.** Every `PolicyArtifact` in this
  build (villain-corpus, console, mcp-server) is a hand-authored object, exactly like the test
  fixtures — a disclosed scope limit, not a gap silently filled by guessed logic.
- **`toxicScore`'s and Scan Token's `riskScore`'s numeric ranges are undocumented by Intercepta
  itself** (confirmed by reading the live OAS — no min, max, or direction is published for either).
  No "high risk" threshold is invented anywhere in this codebase; the screen uses the documented
  trait count instead, and any policy that wants to threshold on a score needs a real keyed call
  against known-risk addresses (Intercepta's pinned Discord test addresses) first to learn what the
  scale actually means.

---

## 14. What's explicitly out of scope, and why

The following were dropped by **explicit user direction during the pivot to the B2B/BEC use case**,
not because any of them failed technically or ran out of time:

- **The Ledger (device signing / WebHID/DMK)** — from the original ETHOnline Implementation PRD.
- **Arc** — from the original ETHOnline Implementation PRD.
- **The Graph** — from the original ETHOnline Implementation PRD.
- **ENSv2 / Curvegrid (MultiBaas)** — from the Commerce Migration PRD's ticket-scalper design. Both
  were researched thoroughly (`docs/VERIFY_FINDINGS.md` items 1 and 2 confirm real, live-fetched API
  contracts for both), but neither ships in the actual B2B/BEC product this document describes.
- **The scalper-ticket villain** as the primary demo narrative — replaced by the spoofed-invoice BEC
  villain. The ticket/ecomm fixtures themselves remain in `packages/issuer-oracle`, tested, "also
  demonstrated," not deleted.

None of these are silent cuts: each is recorded, dated, in `docs/THREATMODEL.md`, per CLAUDE.md rule 6
("state what's NOT built... before writing anything else in `docs/`").
