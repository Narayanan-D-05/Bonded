# BONDED — Commerce Edition: Migration & Implementation PRD

**The mandate proves the agent decided. It doesn't prove what it decided was true.**
Event: ETHGlobal Tokyo 2026 · Sponsors: Intercepta · World (IDKit + World ID for Agents) · Sui · Curvegrid (bonus)
Status: **Migration** from the ETHOnline build (The Graph · Arc · Ledger) — most of the core survives unchanged; the truth-source, authority-source, and settlement chain are swapped.

This document assumes the reader has the original Bonded implementation PRD open alongside it. Every section states explicitly what **carries over unchanged**, what's **rewritten**, and what's **new**. Where a detail depends on a live SDK/API surface not independently verified, it's marked **[VERIFY]**. Do not guess a plausible-looking signature for a `[VERIFY]` item.

**UI/design system: unchanged in this migration.** The customs-and-port-authority visual language, the palette, the typography, and the stamp motion (Part F) all carry over as-is. The plan is to reskin later with Claude Design once the mechanism is proven; this PRD does not ask for new visual work.

---

## Part A — What this is, in one page

**The problem, restated for this domain.** Every agentic-commerce standard shipping in 2026 is built to prove the human's intent was captured, not that the merchant's claims stayed true. Google's AP2 wraps a purchase in three signed mandates — Intent (what the user asked for), Cart (what the agent assembled), Payment (what gets charged) — each carried as a W3C Verifiable Credential, giving an auditable chain from instruction to charge. That's a real cryptographic record of what the *agent decided*. It was never designed to check whether what the agent *believed about the world* — the price, the availability, who the seller actually is — was independently true at the moment of payment. Visa's own June 2026 agent guardrails are spend cap, merchant category, human-approval toggle — all three gate *who* the agent can pay and *how much*, none of them re-verify *what it's buying*.

**The mechanism, unchanged in shape.** The model never produces a payment — only a proposal plus the specific facts it claims justify it. An enforcer that never reads the prompt independently re-derives every one of those facts, right before the Cart Mandate becomes a Payment Mandate. Disagreement means refusal. Anything irreversible or above a threshold pauses for a fresh, live human check.

**What moved.** Truth-source: The Graph → Intercepta (payment/counterparty risk) + a disclosed issuer-oracle (item truth: price, status, seller authenticity). Authority: Ledger hardware → World ID for Agents (no hardware dependency — a genuine simplification, not just a swap). Money: Arc/Solidity → Sui/Move, with verdicts as consumable objects instead of mapping entries — a structurally stronger non-replay guarantee than the EVM version had.

**The one-sentence pitch:** *your agent's shopping cart gets re-checked against reality one heartbeat before it pays — not because it was told to lie, but because nothing today checks whether it was lied to.*

**Why "Bonded" is a better name here than it was originally.** In English, a "licensed and bonded" merchant is the standard phrase for a vendor you can trust with money before delivery — insurance underwriting a promise. That's a closer, more literal fit for a ticket/e-commerce trust layer than it ever was for a DeFi firewall. Say this explicitly in the pitch; it's not a coincidence you have to explain away, it's a gift.

---

## Part B — Migration map: what's kept, what's rewritten, what's new

| Component | ETHOnline version | Commerce Edition | Status |
|---|---|---|---|
| `packages/seam` types (`Proposal`, `Verdict`, `ReasonCode`, `PolicyArtifact`) | DeFi premises (TVL, pool age) | Same shapes, new premise vocabulary (price, event status, seller allowlist, payment risk) | **Kept, extended** |
| `packages/enforcer/src/enforce.ts` — the core loop | vs. Graph/Messari premises | Identical control flow; `resolvePremise` now dispatches across two adapters instead of one | **Kept, unchanged logic** |
| Fixed-point/money discipline (`packages/seam/src/money.ts`) | USDC 6-decimal | Same discipline, same file, same rules | **Kept verbatim** |
| Truth source | `packages/standardized` (Messari subgraphs via The Graph) | `packages/intercepta-adapter` (payment/counterparty risk) + `packages/issuer-oracle` (item truth) | **Rewritten** |
| Authority layer | `packages/authority` (Ledger `ring` + DMK step-up) | `packages/world-agents` (World ID for Agents fresh-verification flow) | **Rewritten — and simplified: no hardware dependency** |
| Settlement | `contracts/` Solidity on Arc (`BondedVault.sol`, `BondedRegistry.sol`) | `move/` Sui Move package — verdicts as consumable objects | **Rewritten** |
| Attack corpus | `AttackToken.sol` + starter-kit harness | Cloned scalper ticket page + bait-and-switch storefront + agent-framework harness | **Rewritten, same discipline** |
| Design system (Part F) | Customs/port-authority theme | **Unchanged** | **Carried over as-is** |
| Demo script shape (Part E) | Compare slider: naive agent complies vs. Bonded refuses | Same shape, new villain | **Kept, recast** |
| README/FEEDBACK discipline, winner strategies (Part I) | — | Consolidated and expanded from every project analyzed this cycle | **New section, most valuable addition** |

The takeaway for the build: **you are not starting over.** The enforcer, the seam, and roughly half the design thinking transfer directly. The real work is two new adapters, one new chain, and a new villain.

---

## Part C — Repository changes

### C.1 Toolchain changes

| Concern | ETHOnline | Commerce Edition | Why |
|---|---|---|---|
| Settlement chain tooling | Foundry (Solidity) | **Sui CLI + Move** — Foundry dropped entirely | Full migration off EVM for settlement; no Solidity remains in the critical path |
| Money-side SDK | Circle Agent Stack / Arc | **Sui TS SDK** (`@mysten/sui`) [VERIFY current package name] | Standard client for building/signing PTBs |
| Authority SDK | `wallet-cli` (Ledger) | **World ID for Agents sandbox** (`sandbox.auth.world.org`) — OIDC-shaped flow, not the IDKit widget | Different product surface from IDKit; read the sandbox docs before architecting, don't assume it behaves like the consumer widget |
| Risk/truth SDK | Graph Gateway client | **Intercepta REST API** (`docs.web3antivirus.io`) + an in-house issuer-oracle service | Intercepta is a plain HTTP API — simplest integration in this whole migration |
| Everything else (pnpm, Turborepo, Next.js, TanStack Query) | — | **Unchanged** | No reason to touch what isn't moving |

### C.2 Full repository tree (diffed against the ETHOnline version)

```
bonded/
├─ apps/
│  ├─ console/                              # UNCHANGED shell, new content
│  │  ├─ app/
│  │  │  ├─ page.tsx                        # / — landing, Compare demo (new villain)
│  │  │  ├─ live/page.tsx                   # /live — unchanged
│  │  │  ├─ log/page.tsx                    # /log — unchanged
│  │  │  ├─ policy/page.tsx                 # /policy — unchanged
│  │  │  ├─ shop/page.tsx                   # NEW — /shop, the ticket/ecomm purchase surface
│  │  │  ├─ corpus/page.tsx                 # unchanged shape, new corpus content
│  │  │  └─ api/
│  │  │     ├─ propose/route.ts             # unchanged
│  │  │     ├─ enforce/route.ts             # unchanged
│  │  │     ├─ stepup/route.ts              # REWRITTEN — World flow instead of DMK
│  │  │     └─ compile-policy/route.ts      # unchanged
│  │  └─ lib/
│  │     ├─ sui-client.ts                   # NEW — replaces arc-client.ts
│  │     ├─ intercepta-client.ts            # NEW
│  │     └─ fixtures/commerce-scenarios.ts  # NEW — replaces attack-scenarios.ts
│  └─ replay/                                # unchanged shell
├─ packages/
│  ├─ seam/                                  # KEPT, extended premise vocabulary only
│  ├─ enforcer/                              # KEPT — same enforce.ts, same tests
│  ├─ intercepta-adapter/                    # NEW — replaces packages/standardized (Graph half)
│  │  ├─ src/{client.ts, schemas.ts, index.ts}
│  ├─ issuer-oracle/                         # NEW — replaces packages/standardized (item-truth half)
│  │  ├─ src/{server.ts, tickets-fixture.ts, ecomm-fixture.ts, index.ts}
│  ├─ world-agents/                          # NEW — replaces packages/authority
│  │  ├─ src/{flow.ts, verify-backend.ts, index.ts}
│  ├─ quarantine/                            # KEPT unchanged
│  ├─ compiler/                              # KEPT unchanged
│  └─ attack-corpus/                         # REWRITTEN content, same harness shape
│     ├─ pages/{scalper-tickets.html, baitswitch-store.html}
│     ├─ harness/{run.ts, agent-frameworks.ts}
│     └─ results.json
├─ move/                                      # NEW — replaces contracts/
│  ├─ sources/{bonded_registry.move, bonded_vault.move, verdict.move}
│  ├─ tests/{bonded_vault_tests.move}
│  └─ Move.toml
├─ FEEDBACK/
│  ├─ INTERCEPTA.md                          # NEW
│  ├─ WORLD.md                               # NEW
│  ├─ SUI.md                                 # NEW
│  └─ CURVEGRID.md                           # NEW, only if the bonus track is entered
├─ docs/
│  ├─ ARCHITECTURE.md                        # updated diagram — same 3-layer shape, new labels
│  ├─ THREATMODEL.md                         # updated — issuer-oracle disclosure lives here
│  ├─ DEMO_SCRIPT.md                         # rewritten per Part E
│  └─ FUTURE.md
└─ (root config files — unchanged: package.json, turbo.json, pnpm-workspace.yaml, README.md)
```

### C.3 Git hygiene — unchanged discipline, one addition

The commit-history discipline from the original PRD carries over unmodified. Add one thing specific to a migration: **the first commit of this branch should be a clean diff against the ETHOnline tag**, so a judge (or you, in six months) can see exactly what moved and what didn't. Tag the old state (`git tag ethonline-v1`) before starting, so `git diff ethonline-v1..HEAD --stat` becomes a one-command proof of how much genuinely changed versus how much is a reskin — and that diff is itself worth a screenshot for the README's "hacky parts" section, because "we didn't start from zero, and here's proof" is a credible, checkable claim.

---

## Part D — Implementation

### D.1 Build order — the dependency chain

1. `packages/seam` — extend the premise vocabulary (Part D.2). Everything else depends on this compiling first.
2. `move/` — deploy `bonded_registry` and `bonded_vault` to Sui testnet **empty**, immediately. A real deployed package ID to build against beats a finished-but-undeployed one.
3. `packages/enforcer` — re-run its existing test suite against the extended types before touching either new adapter. If `enforce.test.ts` still passes untouched, you've confirmed the core genuinely didn't need to change.
4. `packages/intercepta-adapter` — get one live Scan Token / Scan Address call working standalone, against Intercepta's pinned test addresses, before wiring it into `enforce()`.
5. `packages/issuer-oracle` — stand up the disclosed reference oracle (Part D.4) before wiring it in.
6. `packages/world-agents` — the fresh-verification flow, tested against the sandbox independently before it gates anything real.
7. `packages/attack-corpus` — build the villain pages once there's a real enforcer to refuse against.
8. `apps/console` — wire `/shop` last, against real deployed objects and real adapter responses.

### D.2 `packages/seam` — extended premise vocabulary

```typescript
// packages/seam/src/types.ts — ADDITIONS ONLY, nothing existing is removed

export type PremiseOp = 'gte' | 'lte' | 'eq' | 'older_than' | 'younger_than'; // unchanged

export interface Premise {
  id: string;
  schema: string;              // NOW includes 'intercepta-risk' | 'issuer-oracle-tickets' | 'issuer-oracle-ecomm'
                                //   alongside anything carried over from the ETHOnline schema set
  field: string;
  op: PremiseOp;
  value: string;
  toleranceBps?: number;
}

// The Proposal/Verdict/ReasonCode/PolicyArtifact shapes are UNCHANGED from the
// ETHOnline version — see the original seam file. Only the schema STRING VALUES
// premises reference are new; the types that carry them are untouched.
```

**Why this matters for the pitch, not just the code:** you can put the *original* `types.ts` file next to this one in the demo and show that the diff is additive, not structural. That's the single strongest piece of evidence that the underlying mechanism generalizes — a judge doesn't have to take "this is a general primitive" on faith, they can see it in a diff.

### D.3 `packages/enforcer/src/enforce.ts` — unchanged, verified by re-running its own tests

No code changes are prescribed here. The migration's proof point is that `enforce()` — the five-step loop (stale-policy check, forbidden-action check, pinned-block premise resolution, budget check, irreversible-threshold hold) — does not need a single line changed to move domains. `resolvePremise()` is the only touchpoint, and it already dispatched on `def.schema`; it now has two new cases instead of one.

```typescript
// packages/enforcer/src/enforce.ts — the dispatch point, for reference (unchanged file)
const derived = await resolvePremise(def, blockChecked); // routes to intercepta-adapter or
                                                             // issuer-oracle based on def.schema —
                                                             // enforce() itself never knows which
```

### D.4 `packages/issuer-oracle` — the disclosed reference oracle

**Read this before writing any code in this package.** There is no universal, hackathon-accessible "primary ticket issuer API" or "canonical e-commerce truth API." Building this component honestly means disclosing exactly what it is: a controlled reference service you run, seeded with known-true data, standing in for what a real primary issuer's API or a merchant's own inventory system would provide in production. This is the same discipline Satoshi Flow used for its price feed — *"On the oracle, honestly: on testnet the feed is pushed by their own reporter, and they'd rather say so than dress a single reporter up as an oracle network"* — and it's the same discipline Tally used for its revenue fixture. State it in exactly that register: plainly, in the first screen of `docs/THREATMODEL.md`, not discovered by a judge.

```typescript
// packages/issuer-oracle/src/tickets-fixture.ts
// THE ONE DELIBERATELY CONTROLLED COMPONENT IN THIS DOMAIN. Isolated in its
// own file, on purpose, exactly like Tally's revenue fixture and Bonded's
// original quarantine boundary — so the honesty question has a one-file answer.

export interface TicketTruth {
  eventId: string;
  faceValueUSD: string;        // 6-decimal fixed point, per the seam's money discipline
  status: 'scheduled' | 'cancelled' | 'postponed';
  authorizedSellers: string[]; // allowlist — primary issuer + verified resale partners only
}

const TRUTH: Record<string, TicketTruth> = {
  'evt-tokyo-showcase': {
    eventId: 'evt-tokyo-showcase',
    faceValueUSD: '45000000',           // $45.00
    status: 'scheduled',
    authorizedSellers: ['issuer-primary', 'resale-verified-1'],
  },
  // seed 2-3 more, covering: a price-drift case, a cancelled-event case, and
  // an unauthorized-seller case — so the demo can show all three refusal reasons
};

export async function fetchTicketTruth(eventId: string): Promise<TicketTruth | null> {
  return TRUTH[eventId] ?? null;
}
```

```typescript
// packages/issuer-oracle/src/schemas.ts — the resolvePremise() adapter side
export const issuerOracleTickets = {
  fields: {
    'ticket.faceValueUSD': async (eventId: string) => (await fetchTicketTruth(eventId))?.faceValueUSD,
    'ticket.status': async (eventId: string) => (await fetchTicketTruth(eventId))?.status,
    'ticket.sellerAuthorized': async (eventId: string, seller: string) =>
      (await fetchTicketTruth(eventId))?.authorizedSellers.includes(seller),
  },
};
```

A production version replaces `TRUTH` with a real call to a primary issuer's inventory API or a merchant's own systems — the `enforce()` loop and the `Premise` shape don't change at all when that swap happens, which is worth stating explicitly as the "what a real deployment looks like" line in the README.

### D.5 `packages/intercepta-adapter` — the real, live, load-bearing integration

This is the one adapter in the whole migration with zero disclosure caveats — it's a real API, called live, exactly as their qualification requires.

```typescript
// packages/intercepta-adapter/src/client.ts
const INTERCEPTA_BASE = 'https://api.web3antivirus.io'; // [VERIFY] exact base URL against
                                                            // docs.web3antivirus.io/reference/api-overview

export async function scanToken(tokenAddress: string, chain: string): Promise<{ isLookalike: boolean; riskScore: number }> {
  const res = await fetch(`${INTERCEPTA_BASE}/scan/token`, {
    method: 'POST',
    headers: { 'x-api-key': process.env.INTERCEPTA_API_KEY!, 'content-type': 'application/json' },
    body: JSON.stringify({ address: tokenAddress, chain }),
  });
  const json = await res.json();
  return { isLookalike: json.isLookalike, riskScore: json.riskScore }; // [VERIFY] exact response shape
}

export async function scanAddress(address: string, chain: string): Promise<{ sanctioned: boolean; scamExposure: boolean; riskScore: number }> {
  // Deep Scan Address — sanctions, AML, scam exposure. Used for both payTo
  // and payer, per Intercepta's own stated leanings.
  // [VERIFY] exact endpoint path and response shape against docs.web3antivirus.io/reference/scan-address
}

export async function scanMessage(payload: unknown): Promise<{ authorized: boolean; anomalies: string[] }> {
  // Screens the payment authorization itself, not just the addresses.
  // [VERIFY] against docs.web3antivirus.io/reference/scan-message
}
```

```typescript
// packages/intercepta-adapter/src/schemas.ts
export const interceptaRisk = {
  fields: {
    'payment.payTo.riskScore': async (payTo: string, chain: string) => (await scanAddress(payTo, chain)).riskScore,
    'payment.token.isLookalike': async (token: string, chain: string) => (await scanToken(token, chain)).isLookalike,
  },
};
```

**No cache, ever, on this path** — same rule as the original Bonded's Graph queries, for the same reason: a stale risk verdict is a correctness bug, not a latency optimization, and Intercepta's own qualification language is explicit that the call must run *before* the payment is signed or accepted, live, every time — *"Mocked or hard-coded responses don't qualify."*

**Critical, easy-to-miss requirement:** *"Our risk data covers mainnet, so screen real mainnet addresses even when the payment runs on a testnet."* Get the pinned known-risk test addresses from their Discord channel on Day 1 — this is not optional plumbing, it's a stated qualification bar, and missing it silently disqualifies the track entry even if everything else works.

### D.6 `packages/world-agents` — the fresh-verification step-up, no hardware

```typescript
// packages/world-agents/src/flow.ts
// World ID for Agents is OIDC-shaped, NOT the IDKit consumer widget — read
// http://sandbox.auth.world.org/docs before writing this file; do not assume
// it behaves like a QR-code widget drop-in.

export interface WorldStepUpRequest {
  proposalHash: `0x${string}`;
  reason: string;            // shown to the human, e.g. "confirm purchase of 2 tickets, $90.00, non-refundable"
}

export async function initiateStepUp(req: WorldStepUpRequest): Promise<{ authUrl: string; state: string }> {
  // Initiates a fresh-authentication request scoped to this specific
  // proposal. [VERIFY] exact request shape against the sandbox docs —
  // this is likely an authorization-request pattern, not a widget mount.
}

export async function handleCallback(code: string, state: string): Promise<{ verified: boolean; sub: string } | { denied: true } | { expired: true }> {
  // Backend-side token exchange and validation — per the track's own
  // explicit requirement: "Validate identity results in a secure backend;
  // do not expose client secrets or treat an unvalidated client response
  // as authorization." This function is what makes that requirement true;
  // the frontend never sees anything it could forge a "verified" result from.
}
```

```typescript
// apps/console/app/api/stepup/route.ts
// REWRITTEN from the DMK version. No physical device, no WebHID session —
// a redirect-based fresh-auth flow instead. The required "denied, expired,
// cancelled, or otherwise unsuccessful path where the protected action does
// not occur" maps directly onto Bonded's existing REFUSED/expired states —
// wire handleCallback()'s three outcomes straight into the existing
// ReasonCode enum rather than inventing new states.
```

**The identity-placement argument — write this explicitly, it's the strongest World-track paragraph available.** Per the ArcAsset/HORS pattern from the research: state precisely *where* the check sits and precisely where it deliberately doesn't. Here: the fresh World check gates *only* the moment a proposal crosses `irreversibleAboveUSDC` or is flagged non-refundable — never merchant browsing, never low-value purchases, never routine repeat orders under the threshold. Say why: adding friction everywhere would be exactly the rubber-stamp failure mode the whole HITL research literature warns about — *"users habituate to confirmation prompts... the control stops providing its intended check."* A rare, meaningful pause beats a frequent, ignored one. This is also your direct answer to the approval-fatigue research if a judge raises it.

### D.7 `move/sources/bonded_vault.move` — settlement, structurally non-replayable

```move
// move/sources/bonded_vault.move
// [VERIFY] exact module paths and Coin/Balance API surface against the
// current Sui Move standard library and @mysten/sui docs before finalizing —
// this sketch shows the OBJECT-MODEL SHAPE, not a guaranteed-compiling file.

module bonded::bonded_vault {
    use sui::object::{Self, UID};
    use sui::coin::Coin;
    use sui::balance::Balance;
    use sui::tx_context::TxContext;
    use sui::transfer;

    /// Held by the enforcer's address. Minting a Verdict object requires
    /// presenting this capability — the type system, not an if-check,
    /// is what makes it impossible for anything else in the codebase to
    /// forge a valid verdict. This is the structural-attenuation property
    /// the original Bonded's Solidity version could only approximate with
    /// an ECDSA signature check.
    struct EnforcerCap has key, store { id: UID }

    /// Minted only by a function that has already called
    /// world_agents::consume_fresh_verification — see bonded_registry.move.
    /// Presence of this object IS the proof a human confirmed, on-chain,
    /// not a flag that could be set true by a compromised backend.
    struct StepUpApproval has key, store { id: UID, proposal_hash: vector<u8> }

    /// A verdict is an OBJECT, not a mapping entry. It is CONSUMED by
    /// settle() — after use it no longer exists, which is a stronger
    /// non-replay guarantee than the EVM version's `settled[hash] = true`
    /// mapping check ever was: there is no boolean to forget to check,
    /// because there is nothing left to check against.
    struct Verdict has key, store {
        id: UID,
        proposal_hash: vector<u8>,
        policy_hash: vector<u8>,
        outcome: u8,          // 0 CLEARED, 1 REFUSED, 2 HELD_FOR_STEPUP
        reason_code: u16,
        value_usdc: u64,
    }

    struct Vault has key {
        id: UID,
        balance: Balance<sui::sui::SUI>,   // [VERIFY] swap for the correct
                                              // stablecoin type available on
                                              // Sui testnet — likely a
                                              // bridged/native USDC coin type,
                                              // confirm before Day 4
        spent_this_period: u64,
    }

    /// Only the enforcer can mint a Verdict — enforced by requiring the
    /// capability as an argument, not by an address check inside the body.
    public fun mint_verdict(
        _cap: &EnforcerCap,
        proposal_hash: vector<u8>,
        policy_hash: vector<u8>,
        outcome: u8,
        reason_code: u16,
        value_usdc: u64,
        ctx: &mut TxContext,
    ): Verdict {
        Verdict { id: object::new(ctx), proposal_hash, policy_hash, outcome, reason_code, value_usdc }
    }

    /// Consumes the Verdict object — after this call it is gone. A CLEARED
    /// verdict releases funds in the SAME transaction it's consumed in, so
    /// there is no separate "confirm" step for the routine path to forget.
    public fun settle(vault: &mut Vault, verdict: Verdict, recipient: address, ctx: &mut TxContext) {
        let Verdict { id, proposal_hash: _, policy_hash: _, outcome, reason_code: _, value_usdc } = verdict;
        object::delete(id); // the verdict is consumed here — cannot be reused

        if (outcome == 0) { // CLEARED
            vault.spent_this_period = vault.spent_this_period + value_usdc;
            // transfer value_usdc worth of balance to recipient — [VERIFY]
            // exact Coin::split/transfer pattern for the chosen stablecoin type
        }
        // outcome == 1 (REFUSED): the verdict is already destroyed above;
        // nothing executes. outcome == 2 should never reach settle()
        // directly — see settle_with_stepup below.
    }

    /// The step-up path. Requires BOTH a HELD_FOR_STEPUP verdict AND a
    /// StepUpApproval object minted only via a real World fresh-verification
    /// — the same "two signatures, never one" discipline the original
    /// Ledger version enforced, expressed here as two objects the function
    /// must consume rather than one signature check plus one flag.
    public fun settle_with_stepup(
        vault: &mut Vault, verdict: Verdict, approval: StepUpApproval,
        recipient: address, ctx: &mut TxContext,
    ) {
        assert!(verdict.proposal_hash == approval.proposal_hash, 0); // [VERIFY] error code convention
        let Verdict { id, value_usdc, .. } = verdict;
        object::delete(id);
        let StepUpApproval { id: approval_id, .. } = approval;
        object::delete(approval_id);

        vault.spent_this_period = vault.spent_this_period + value_usdc;
        // transfer as above
    }
}
```

**Why this is worth explaining fully in the pitch, not just building:** the capability pattern here is a direct, checkable answer to the "what stops the enforcer itself from being compromised" objection carried over from the ETHOnline threat model. In the Solidity version, a compromised enforcer host could theoretically forge a signature if the key ever leaked. In Move, `EnforcerCap` is a real object that must physically exist in a specific address's inventory to be passed as an argument — there is no "signature" to leak, only an object to steal, and stealing an object is a different, more visible, more constrainable threat model than leaking a key. Say this difference out loud; it's genuine technical depth, not decoration.

### D.8 `packages/attack-corpus` — the new villain

```
packages/attack-corpus/pages/scalper-tickets.html
```
A real, deployed static page: an event listing showing "$89, 2 left," styled convincingly, for an event whose real primary-issuer face value (per the issuer-oracle fixture) is $45 and whose seller isn't on the authorized-sellers allowlist. This is the direct domain-equivalent of the original `AttackToken.sol` — same function in the demo, same "deploy it once, reference it from both sides of the Compare slider" discipline.

```
packages/attack-corpus/pages/baitswitch-store.html
```
An e-commerce checkout that shows one price on the product page and silently inflates it at the payment step — the generalized ecomm version of the same premise-mismatch mechanism.

```typescript
// packages/attack-corpus/harness/run.ts
// Same shape as the ETHOnline harness: for each of N public agentic-commerce
// starter kits/frameworks, point it at scalper-tickets.html with an
// identical natural-language task ("buy 2 tickets to this show"), record
// whether it paid the scalper price without re-checking, then run the
// identical task through Bonded and record the verdict. results.json is
// the source of the README's "N of M" line — generated, never hand-typed,
// per the discipline established across every prior project in this series.
```

---

## Part E — Demo script, click by click

| Step | Surface | Action | What the judge sees |
|---|---|---|---|
| 1 | `/` landing | Land, no wallet prompt | `Compare` slider: naive shopping agent (left) pays the scalper's $89 for a $45 ticket from an unauthorized seller; Bonded (right) refuses the identical purchase, mismatch on screen |
| 2 | `/` landing | Scroll | Real Intercepta scan result screenshot — the payTo address flagged, live, not mocked |
| 3 | `/shop` | Submit the same scenario live (one click) | Premise diff table: claimed price $89 vs. issuer-truth $45, claimed seller vs. authorized-sellers allowlist — both mismatches visible simultaneously |
| 4 | `/shop` | Submit a large, otherwise-valid, non-refundable purchase | `HELD_FOR_STEPUP` — no silent auto-approval of an irreversible spend |
| 5 | Browser | Trigger the World fresh-verification flow | Real redirect, real backend validation, `StepUpApproval` object minted on Sui, purchase completes |
| 6 | `/shop` (variant) | Cancel the World flow mid-way, or let it expire | Required denied/expired path — purchase does not occur, state visible |
| 7 | `/log` | Scroll the decision log | Every entry links to a real Sui explorer object/transaction |
| 8 | `/corpus` | View results | `results.json`-driven: N of M starter kits paid the scalper; Bonded refused all M |

Steps 1–4 and 7–8 need zero setup. Steps 5–6 need a real World sandbox flow completed on camera — film it directly, don't describe it.

---

## Part F — Design system: unchanged

No new design work is prescribed by this migration. Carry over, verbatim, from the original PRD:

- **Palette:** `harbor #0B1A22` · `deepwater #122733` · `hairline #1E3A47` · `manifest #ECEEEA` · `ink #0E1614` · `seal #3FA37A` (CLEARED) · `stamp #C2452C` (REFUSED) · `hold #E0A33C` (HELD_FOR_STEPUP).
- **Type:** Instrument Sans + JetBrains Mono (`tabular-nums`, every number, no exceptions).
- **Motion budget:** exactly one — the inspection-stamp animation on `REFUSED`.
- **Components:** Aceternity `Compare` (hero — new content, same component), `Multi Step Loader` (policy compile), `Tracing Beam` (`/log`); React Bits `Decrypted Text`, `Spotlight Card`; shadcn `Table`, `Dialog`.

The only content-level change: the premise diff table's columns now read *claimed price / issuer price* and *claimed seller / authorized sellers* instead of *claimed TVL / derived TVL* — same component, same styling, different domain vocabulary. When a full reskin happens later, do it with Claude Design against this same token system rather than starting from a blank canvas — the "licensed and bonded" merchant metaphor (Part A) is a strong enough hook that the *next* design pass should probably lean into it explicitly, but that's future work, not this migration's scope.

---

## Part G — Testing matrix

| Layer | File | Must prove |
|---|---|---|
| Enforcer | `enforce.test.ts` (re-run, not rewritten) | Every `ReasonCode` branch still reachable with zero changes to the file itself — the strongest possible proof the core generalizes |
| Intercepta adapter | `intercepta-adapter.test.ts` | Live call against pinned test addresses returns the expected risk classification; `cache: 'no-store'` is asserted, not assumed |
| Issuer oracle | `issuer-oracle.test.ts` | All three seeded scenarios (price drift, cancelled event, unauthorized seller) resolve correctly |
| World flow | manual, Part E step 6 | The denied/expired path genuinely blocks settlement — verified by attempting `settle_with_stepup` with no valid `StepUpApproval` object and confirming it aborts |
| Move | `bonded_vault_tests.move` | A `Verdict` object cannot be consumed twice (compiler/runtime enforced, write a test that tries and confirms it fails); `settle_with_stepup` reverts if `proposal_hash` mismatches between the two objects |
| Attack corpus | `results.json` reproducibility | Re-running the harness against the same pinned starter-kit commits reproduces the same verdicts |
| End-to-end | `docs/DEMO_SCRIPT.md` | Part E run start to finish, cold, before every submission checkpoint |

---

## Part H — Sponsor qualification matrix (verbatim Tokyo text)

### H.1 Intercepta — Safe Agent-to-Agent Payments with x402

| Requirement (verbatim) | Satisfied by |
|---|---|
| "Use the Intercepta API inside an agent payment flow, so every payment is screened before the agent signs it or the service accepts it" | `packages/intercepta-adapter`, called from `enforce()` step 3, before any settlement |
| "Show the verdict in the flow and let it decide what happens next: pay, refuse, cap the amount or ask a human" | The existing `ReasonCode`/`outcome` machinery — CLEARED / REFUSED / HELD_FOR_STEPUP maps onto pay / refuse / ask-a-human directly; "cap" maps to the existing budget-check branch |
| "At least one live call to the Intercepta API runs before a payment is signed or accepted... Mocked or hard-coded responses don't qualify" | D.5 — real fetch, no cache, on the enforcement path |
| "Screen real mainnet addresses even when the payment runs on a testnet" | Pinned Discord test addresses used in `packages/attack-corpus` |
| "Your demo shows one payment that goes through and one that is blocked or held, with the reason visible" | Demo script steps 1 and 3 |

### H.2 World — IDKit + World ID for Agents

| Requirement (verbatim) | Satisfied by |
|---|---|
| "Use the credential that is proportionate to your use case... We are rewarding the best decision about which credential is needed" | Fresh verification only above `irreversibleAboveUSDC` or on non-refundable items — argued explicitly in D.6, not just implemented |
| "Demonstrate a successful verification and one meaningful alternative path" (IDKit) / "a denied, expired, cancelled, or otherwise unsuccessful path" (Agents) | Demo script step 6 |
| "Validate identity results in a secure backend; do not expose client secrets or treat an unvalidated client response as authorization" | `handleCallback` runs server-side; the frontend never receives anything it could forge a verified result from |
| "A meaningful action that needs a human identity or approval layer, not simply a login screen" | The step-up gates an irreversible payment, not account access |

### H.3 Sui — DeFi & Payments

| Requirement (verbatim) | Satisfied by |
|---|---|
| "Systems that move, manage, and transform money programmatically... Vaults and capital allocators... Financial abstractions for real users" | `move/sources/bonded_vault.move` — a real capital allocator gated by object capabilities, for a genuinely consumer-facing use case |

### H.4 Curvegrid — bonus, near-zero marginal cost

| Requirement (verbatim) | Satisfied by |
|---|---|
| "Policy-Aware Transaction Agent — Propose or execute transactions while respecting rules such as spending limits, approved counterparties, or required human approvals" | Bonded's entire architecture, essentially verbatim |
| README structure: one-sentence summary, MultiBaas usage (optional), team intro, setup instructions, MultiBaas feedback | `FEEDBACK/CURVEGRID.md` — MultiBaas itself is explicitly not required, so this can be entered with zero additional integration work if time is short |

---

## Part I — Winning strategies and selling collateral

This section consolidates every pattern found valuable across the research for this event, applied specifically to this build. Treat it as the checklist to satisfy before submission, not background reading.

### I.1 The first sentence has to be human, not technical

The single clearest lesson from Keel's underperformance: a sentence only a specialist parses loses the room in the first three seconds. Lead with:

> "Your shopping agent trusts whatever the page says. We built the thing that checks."

Not: "a re-derivation enforcer for agentic commerce mandates." Save the mechanism for the second breath.

### I.2 Build the villain, and let it be the demo's climax

Every strong submission analyzed this cycle — Proof of Scan's cloaked phishing site, Bonded's own original attack token — puts a real, deployed antagonist on screen rather than describing a risk abstractly. The scalper page and the bait-and-switch checkout (Part D.8) are that antagonist here. The climax of the demo is the refusal, not the successful purchase — design the pitch's pacing around that moment, not around showing every feature.

### I.3 Name what's load-bearing, per sponsor, in one sentence each

Every winner analyzed states explicitly what breaks if a given sponsor's tech is removed. Use this exact framing in the README:

- *Remove Intercepta: the enforcer can no longer independently verify counterparty and token risk — the payment leg of the truth-check disappears entirely.*
- *Remove World: an irreversible purchase has no human confirmation path — it either always auto-approves (unsafe) or always blocks (unusable).*
- *Remove Sui: there is no capital allocator to gate — the verdict has nothing to release money against.*

### I.4 Honest disclosure, in the register that wins

Satoshi Flow's README is the standard to match: a plain, first-person admission of exactly where the system's truth stops being independently verified, placed early, not buried. Apply it here verbatim in structure:

> "On the issuer oracle, honestly: there is no universal API a hackathon team can call for real primary-ticket-issuer truth, so ours is a controlled reference service seeded with known data, standing in for what a production integration with a real issuer or merchant system would provide. We'd rather say so than dress a fixture up as a live feed."

Pair it with a "what is deliberately not built" section, carried over from the original Bonded: no defense against a compromised enforcer beyond the capability-object boundary; no coverage of every possible attacker-writable field; no live legal KYC beyond World's own verification.

### I.5 One quantified receipt, generated not hand-typed

Every winning submission analyzed has exactly one number a judge can check. Here it's `results.json`'s output: *"N of M public agentic-commerce starter kits paid the scalper's inflated price with no re-verification. Bonded refused all M."* Generate it from a real harness run against pinned commits — see D.8 — and never hand-type the number into the README.

### I.6 The deep-questions bank, rehearsed

- **"Isn't this just a price-check API call?"** No — the mechanism is that the model never trusts its own belief with money. The premise-diff and re-derivation architecture is the same one that would catch a DeFi prompt injection or a fabricated TVL claim; commerce is one instantiation of a general primitive, not a bespoke price-checker. Point to Part D.2's additive-diff proof.
- **"What stops the enforcer itself from being compromised?"** Answered structurally, not just asserted: `EnforcerCap` must physically exist as an object in a specific address's inventory to mint a valid verdict — there's no signature to leak, only an object to steal, which is a narrower, more visible threat than the EVM version's key-leak risk.
- **"Why does the World check only sometimes fire?"** Because per-action friction on every purchase is exactly the rubber-stamp failure the 2026 HITL research documents — *"users habituate to confirmation prompts... the control stops providing its intended check."* State the threshold logic (D.6) explicitly; it's a feature, not a corner cut.
- **"Isn't the issuer-oracle just made up?"** Yes, disclosed on the first screen, not discovered — see I.4. The re-verification mechanism and everything downstream of it are real; only the data source behind one adapter is a labelled fixture.

### I.7 Elevator pitches, three lengths

**Ten seconds:** "Bonded catches your agent before it pays for a lie."

**Thirty seconds:** "Every agent payment standard shipping this year proves the agent decided to buy something. None of them prove what it decided was true. Bonded sits between the cart and the payment and re-checks the claim against reality — live, every time — and pauses for a real human only when the purchase can't be undone."

**Ninety seconds:** "We cloned a scalper's ticket page — $89, 2 left, for a show whose real face value is $45 from an unauthorized reseller. A standard shopping agent pays it, because nothing in the current agent-payments stack — not AP2's signed mandates, not Visa's spend caps — ever asks whether the page told the truth. Bonded does: right before payment, an enforcer that never read the page independently re-checks the price and the seller, screens the payment itself through Intercepta's live risk API, and refuses on mismatch. For anything irreversible, it pauses for a real person to confirm through World, once, only when it actually matters — not on every purchase, because we know from this year's own research that per-action approval prompts turn into rubber stamps. And on Sui, the verdict that releases the money is an object that gets consumed the instant it's used — there's no flag to forget to check, because after settlement there's nothing left to check."

### I.8 Objection handling, positioned against the real competition

- **"AP2/ACP already solve this."** They solve *authorization provenance* — proving the human's intent was captured in a signed chain. They don't solve *claim verification* — whether what the agent believed was ever independently true. Both are needed; Bonded is the second half nobody's built yet.
- **"Isn't this the same DeFi-guardrail idea again?"** It's the same *primitive*, deliberately — that's the point being made in Part D.2's near-zero-diff proof. The domain changed because the audience does: a judge who's never touched DeFi has bought a concert ticket and knows exactly what it feels like to get scalped.
- **"Why should I trust a hackathon team's risk oracle over Visa's guardrails?"** We don't compete with Visa's guardrails — we compose with them. Spend caps and merchant categories are necessary and already shipping; they answer "who and how much." Bonded answers "is what you're about to buy actually what you think it is," which is a different question those systems were never built to ask.

### I.9 Submission mechanics — carried over, checked against this event

- Git history clean from Day 1, tagged against the ETHOnline state (C.3) — the diff *is* evidence.
- `FEEDBACK/*.md` per sponsor, written incrementally through the build, not at the end.
- Every screenshot in the README is real: a real Intercepta response, a real World sandbox redirect, a real Sui explorer object.
- State plainly, once, in the README's first section: which Curvegrid bounty (if any) this is submitted for, per their own instruction to be explicit about bounty targeting elsewhere in this event's tracks.

---

## Part J — Build schedule, tied to files

| Day | Deliverable | Files that must pass |
|---|---|---|
| 1 | Seam extended (D.2). `move/` deployed empty to Sui testnet. Tag `ethonline-v1` before starting. | `packages/seam/*` compiling; package ID on testnet |
| 2 | `enforce.test.ts` re-run unmodified and green against the extended types | Proof the core didn't need to change |
| 3 | Intercepta adapter live against pinned test addresses; issuer-oracle fixture seeded with all three scenarios | D.4, D.5 both standalone-tested |
| 4 | **Scalper page deployed; naive-agent-pays video captured; Bonded-refuses video captured.** | Non-negotiable milestone, same discipline as every prior project in this series |
| 5 | `bonded_vault.move` — routine `settle()` path working end-to-end on Sui testnet | `bonded_vault_tests.move` green |
| 6 | World sandbox flow working end-to-end, including the denied/expired path filmed | Demo script step 6 captured on camera |
| 7 | `/shop` console screen, attack-corpus harness run across N starter kits, video, README, all `FEEDBACK/*.md`, Curvegrid README if entered | `results.json` generated, not hand-typed |

Cut order if behind: Curvegrid bonus track → ecomm bait-and-switch page (keep only the ticket scalper villain) → `/corpus` UI polish (keep the raw `results.json`). **Never cut** the re-derivation engine, the World denied-path proof, or the Sui object-consumption non-replay test — those three are the load-bearing claims for the three tracks that actually pay.

---

## Part K — Open items — resolve before Day 1 ends

1. **[VERIFY]** Exact `@mysten/sui` SDK package name and current PTB-building API — confirm against `docs.sui.io` before D.7's Move code is finalized against a real client.
2. **[VERIFY]** Which stablecoin type is actually available and mintable on Sui testnet for the vault's `Balance<T>` — native, bridged, or a testnet faucet token; this decides one line in `bonded_vault.move` that everything else depends on.
3. **[VERIFY]** World ID for Agents sandbox's exact authorization-request and callback shape — read `sandbox.auth.world.org/docs` fully before writing `packages/world-agents/src/flow.ts`; do not assume it mirrors the IDKit widget's integration pattern.
4. **[VERIFY]** Intercepta's exact response schemas for Scan Token / Scan Address / Scan Message against `docs.web3antivirus.io` — and get the pinned known-risk test addresses from their Discord on Day 1, not Day 4.
5. Confirm the Move error-code convention (`assert!` codes) the team wants to standardize on before D.7's tests are written, so failure messages are consistent across the package.
6. Decide the exact wording of the issuer-oracle disclosure (I.4) as a team, and get it into `docs/THREATMODEL.md` before any other README content is written — it anchors the tone for everything that follows it.
