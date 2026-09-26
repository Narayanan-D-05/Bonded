# Bonded — Product Requirements Document (current, as-built)

**Status: this document describes what is actually built and verified in this repository, in the
present tense, as fact — not a plan, not a migration diff, not a hackathon pitch.** Every file path,
function signature, deployed address, and test count below was read or run directly against the real
repository on 2026-09-26. Where something could not be confirmed this way, it is stated as
unconfirmed rather than guessed (see "Honest disclosures" below).

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
  answers "is this claimed address independently known to be bad," as opposed to "does it match our
  own records."
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
  dispatcher/         Routes a policy's premise to the adapter that owns it; canonicalHash/computeLogRef; createEnforceDeps
  issuer-oracle/      Vendor-master truth (disclosed stand-in) + the older ticket/ecomm fixtures (kept, demoted)
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
  console/            Invoice Inbox demo app (Next.js) — lib/enforce-deps.ts is its one composition point
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

**Why this package owns `canonicalHash`, and why every caller must use this exact implementation:**
`bonded_registry.move`'s `commit_policy` stores an opaque `vector<u8>` that Move compares only for
byte-equality — there is no on-chain-enforced hash scheme to conform to (confirmed by reading the
actual Move source). Since nothing external dictates the hash function, this package's own choice
(recursive key-sorting + bigint-tagging + `JSON.stringify` + sha256) is authoritative for the whole
repo. Every caller that needs its locally-computed policy hash to actually equal an on-chain
commitment (console, mcp-server, villain-corpus) imports and calls this exact function — two
"reasonable" canonicalizations of the same object produce different bytes and would trip
`STALE_POLICY` spuriously, or worse, silently agree on one shape and silently diverge on the next.

**Tests:** 13, all passing, including a real end-to-end test wiring `issuerOracleVendors` (no mocks)
to prove the BEC mismatch resolves through the real router, not only through hand-rolled test doubles.

---

## 6. The two truth sources

### 6a. Issuer-oracle (`packages/issuer-oracle`) — disclosed vendor-master stand-in

**Stated honestly, in the file itself, before anything else:** `vendor-fixture.ts` is "a controlled,
seeded reference service we run ourselves, standing in for what a real vendor-master/ERP system (SAP,
NetSuite, a bank's own beneficiary registry, etc.) would tell an AP-automation enforcer in
production. It is not a live feed from any real vendor-master or ERP system, and it is never described
as one anywhere in this codebase."

Three seeded vendors, ids stable across every downstream package:

| Vendor id | Status | Payout address | Invoice amount | Scenario |
|---|---|---|---|---|
| `vnd-acme-supplies` | `active` | old (>1yr) `payoutAddressLastChangedAt` | $1,250.00 | Clean — `CLEARED`/`OK` |
| `vnd-globex-freight` | `active` | changed **3 days** before baseline (a real, legitimate bank change) | $8,450.00 | Villain-corpus fabricates a *different* fraudulent claim against this same vendor id — this fixture states only the truth |
| `vnd-suspended-corp` | `suspended` | n/a to the scenario | $4,200.00 | Hard-refuse regardless of what's claimed |

```ts
export interface VendorTruth {
  vendorId: string; legalName: string; payoutAddress: `0x${string}`;
  invoiceAmountUSD: string; status: 'active' | 'suspended'; payoutAddressLastChangedAt: number;
}
export async function fetchVendorTruth(vendorId: string): Promise<VendorTruth | null>
```

`issuerOracleVendors` (in `schemas.ts`) exposes `vendor.payoutAddress` / `vendor.status` as plain
strings (categorical, compared via `op: 'eq'`), and `vendor.invoiceAmountUSD` /
`vendor.payoutAddressLastChangedAt` as `bigint` (money/timestamp, never a native `number`).

The older `tickets-fixture.ts` (`evt-tokyo-showcase`, `evt-osaka-arena`, `evt-cancelled-fest`) and
`ecomm-fixture.ts` (`prod-camera-x200`, `prod-headphones-acme`, `prod-sneakers-zeta`) — from the
scalper-ticket and bait-and-switch-checkout villain scenarios of the earlier, superseded designs —
remain in the package, tested, and exported (`issuerOracleTickets`, `issuerOracleEcomm`). They are
"also demonstrated," not the primary narrative and not deleted.

**Tests:** 29, all passing.

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

**The Sui-address limitation, stated plainly, not glossed over:** Intercepta's address-scan endpoints
take "an ETH address/ENS" (the documented parameter description) — a 20-byte EVM address or a
lowercase ENS name. `parseScreeningSubject` in `client.ts` actively **rejects** a 32-byte Sui address
before any network call is made, with an explanatory error naming exactly why. This is not a bug to
fix quietly; it is a real, structural gap between the settlement chain this project uses (Sui) and the
chain family Intercepta screens (EVM). See §11 for the concrete consequence and §12 for what a
production fix looks like, and see `sponsers.md`'s Intercepta section for the full caveat.

`resolvePremise` exposes only the fields that are already numeric in Intercepta's own documented
schema (`toxicScore`, trait/detector counts, token `riskScore`) as `bigint`. Categorical fields
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
`#fraudulent-payout-address[data-address]`. The page's own red-flags section and its "$3.04 billion"
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

An optional fourth scenario screens the fraudulent address through the real
`@bonded/intercepta-adapter`, gated on `INTERCEPTA_API_KEY` — if the key is absent, this is a visible,
recorded "not run: missing key" status, never a silent skip; and even with a key present, this
scenario is **expected to fail** for a structural reason: the fraudulent address is 32-byte Sui-shaped,
and Intercepta's address endpoints reject anything that isn't a 20-byte EVM address or ENS name before
any network call is made (see §6b). The harness writes its own `packages/villain-corpus/results.json`
(structurally similar to, but entirely separate from, the frozen `packages/attack-corpus/results.json`
— that package is never touched).

**Tests:** 4, all passing — the three deterministic outcomes above, run with no live network call,
plus a check that the fraudulent address embedded in the page is a well-formed, distinct 32-byte hex
value.

### 9b. Console (`apps/console`) — Invoice Inbox

A Next.js app whose one composition point, `lib/enforce-deps.ts`, wires the real
`@bonded/dispatcher`'s `createEnforceDeps` against the real `issuerOracleVendors` registry and mirrors
villain-corpus's three scenarios field-for-field (same premise ids, same policy shapes, same proposal
ids — copied by directly reading `spoofed-invoice.html`, not by importing `@bonded/villain-corpus`,
which is not in this app's dependency list).

Routes: `app/invoices/page.tsx` (the inbox listing the three demo invoices), `app/api/enforce/route.ts`
(`POST { invoiceId }` → runs the real `enforce()`, returns the `Verdict` plus the claimed/derived pair
for **every** premise checked, not only the mismatched one — CLAUDE.md rule 5), `app/invoices/[id]/
page.tsx` (the premise-diff table + outcome badge), `app/stepup/page.tsx` + `app/api/stepup/route.ts`
(thin wrappers over `@bonded/world-agents`'s already-built `initiateStepUp`/`handleCallback`/
`decideStepUp` — no new logic added here; the route never trusts a client-supplied proposal, it always
re-derives the real verdict from the fixed set of 3 demo invoices before starting a World attempt).

Out of scope by design, stated in the composition file itself: browser-side Sui wallet signing (never
built, per CLAUDE.md rule 3), auth, multi-tenancy.

**Tests:** 18, all passing.

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
choice was made. Two integration paths are shown side by side in the package README: direct SDK usage
(`import { enforce } from '@bonded/enforcer'`, or even more directly `import { verifyInvoicePayment }
from '@bonded/mcp-server'`) versus adding it as an agent tool (`claude mcp add bonded-mcp -- node
./packages/mcp-server/dist/server.js`).

**A hosted, multi-tenant gateway is roadmap only — not built.** Named explicitly as such in
`docs/THREATMODEL.md`; nothing in this repo stands one up.

---

## 11. Testing matrix — real, observed counts

Run directly against this repository on 2026-09-26 (`pnpm --filter <name> test` for every TypeScript
package, `sui move test` inside `move/`). These are the actual numbers observed, not carried over from
an earlier document:

| Package | Test suites | Tests | Result |
|---|---|---|---|
| `@bonded/seam` | 2 | 20 | all passing |
| `@bonded/enforcer` | 3 | 41 | all passing |
| `@bonded/dispatcher` | 1 | 13 | all passing |
| `@bonded/issuer-oracle` | 1 | 29 | all passing |
| `@bonded/intercepta-adapter` | 1 | 46 | all passing |
| `@bonded/world-agents` | 3 | 59 | all passing |
| `@bonded/villain-corpus` | 1 | 4 | all passing |
| `@bonded/mcp-server` | 1 | 6 | all passing |
| `@bonded/console` | 1 | 18 | all passing |
| `move/` (`sui move test`) | — | 12 | all passing |
| **Total** | | **236 TS tests + 12 Move tests = 248** | |

Every one of these suites runs with no live sponsor API key required (Intercepta's client is fully
unit-tested against strict response-shape validation with no live call; World's tests hit the real
JWKS/discovery endpoints read-only but never require a registered client secret; the villain-corpus
harness's optional live-Intercepta scenario is explicitly excluded from its test suite and only runs
via `tsx harness/run.ts` when a key is present).

---

## 12. Sponsor qualification (brief — see `sponsers.md` for full detail)

| Sponsor | Real, live integration | Package(s) |
|---|---|---|
| **Sui** | On-chain settlement objects, deployed and smoke-tested on testnet; object-capability replay guard | `move/`, package `0xf3d914b3…bf57a` |
| **Intercepta** | Live Web3 Antivirus HTTP client, no mocks, no cache, sha256 evidence storage | `packages/intercepta-adapter` |
| **World** | Live OIDC sandbox relying-party flow, real JWKS verification, proposal-scoped step-up | `packages/world-agents` |

See `sponsers.md` for what each sponsor is, why it was chosen, exactly where it's implemented, what
would break without it, and — for Intercepta specifically — the honest Sui-address caveat.

---

## 13. Honest disclosures / what's not built

Stated here, consistent with `docs/THREATMODEL.md`'s own dated entries — nothing below is a gap
discovered by a reviewer that this document tries to hide:

- **The issuer-oracle is a disclosed, controlled fixture**, not a live vendor-master/ERP feed. Its own
  file header says so before any code in it runs. A production deployment replaces `TRUTH` (the
  in-memory map) with a real call to a real vendor-master/ERP system (SAP, NetSuite, a bank's own
  beneficiary registry); `fetchVendorTruth`'s async, one-id-in/one-record-out signature does not
  change when that swap happens.
- **Intercepta cannot screen this project's Sui-shaped payout addresses.** Confirmed by reading the
  documented parameter description ("ETH address/ENS") and enforced structurally in code
  (`parseScreeningSubject` rejects a 32-byte Sui address before any network call). This is not a bug;
  it is a real mismatch between the settlement chain (Sui) and the chain family Intercepta screens
  (EVM). See `sponsers.md`'s Intercepta section for the full caveat and the production fix.
- **`enforce()`'s output is not wired to a real on-chain `settle()` call.** Confirmed by reading the
  actual current `apps/console/lib/enforce-deps.ts` and `packages/mcp-server/src/tools/
  verify-invoice-payment.ts`: neither imports a Sui SDK, neither calls `settle`/`settle_with_stepup`,
  and both explicitly document that their `getCheckpoint()` is a unix-timestamp stand-in, not a real
  Sui checkpoint. `move/`'s settlement layer is deployed, smoke-tested, and unit-tested
  independently — but the TypeScript enforcement layer and the Move settlement layer are not yet
  connected by a real transaction-building call from either app. This is the single largest remaining
  gap before an end-to-end, on-chain demo is possible, and it is named as such in
  `docs/THREATMODEL.md`, not discovered here for the first time.
- **`site/spoofed-invoice.html` is not hosted anywhere public yet.** It is a complete, real static
  file, referenced by its own provenance footer as "not deployed anywhere yet" — a Vercel/GitHub Pages
  deployment is a real next step, not done.
- **There is no natural-language "intent → PolicyArtifact" compiler.** Every `PolicyArtifact` in this
  build (villain-corpus, console, mcp-server) is a hand-authored object, exactly like the test
  fixtures — a disclosed scope limit, not a gap silently filled by guessed logic.
- **`toxicScore`'s and Scan Token's `riskScore`'s numeric ranges are undocumented by Intercepta
  itself** (confirmed by reading the live OAS — no min, max, or direction is published for either).
  No "high risk" threshold is invented anywhere in this codebase; the raw integer is passed straight
  through, and any policy that wants to threshold on it needs a real keyed call against known-risk
  addresses first to learn what the scale actually means.

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
