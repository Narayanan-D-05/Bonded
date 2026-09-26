# Sponsors — Intercepta, Sui, World

This document covers, for each of this build's three sponsors, what it is, why it was chosen for
this specific B2B accounts-payable / Business Email Compromise (BEC) product, exactly where it's
implemented (real package/file paths, read directly from this repository), why it's important to
this project (what breaks or becomes impossible without it), and what problem it specifically solves
in the BEC/AP scenario. A closing note explains why Curvegrid/MultiBaas and ENS are absent.

---

## Intercepta (Web3 Antivirus)

### What it is / what it does

Intercepta (branded "Web3 Antivirus" at the API level) is a live, hosted risk-screening service for
crypto addresses, tokens, and off-chain signatures. Its documented endpoints — Quick Scan Address,
Deep Scan Address, Scan Token, and Scan Message — return a numeric/categorical risk assessment
(`toxicScore`, `riskScore`, `riskLevel`, trait/detector lists such as `known_scammer`,
`sanction_address`, `rug_pull`, `mixer_transfers`) for an EVM address, an ENS name, or an ERC-20
contract, backed by Intercepta's own aggregated threat intelligence. It is a real, keyed HTTP API at
`https://api.web3antivirus.io`, not a static blocklist a project ships with its own code.

### Why we chose it for this product

The core BEC scenario in this build is: an attacker impersonates a real vendor and claims a different
payout address. `packages/issuer-oracle`'s vendor-master fixture answers "does the claimed address
match what *our own records* say" — a closed-world check against data this project controls.
Intercepta answers a genuinely different, complementary question: "is this claimed address
*independently* known, by a party with no stake in this transaction, to be associated with scams,
sanctions, phishing, or fraud." A vendor-master mismatch alone tells an AP desk "this doesn't match
what we have on file" — useful, but silent on whether the *new* claimed address is actively known-bad
elsewhere. Intercepta is the one truly live, real-time, third-party risk signal in the entire stack;
every other adapter in this repo is deliberately, honestly disclosed as a controlled fixture. Choosing
it was not incidental to the BEC use case — a real AP fraud-prevention product genuinely needs a
live threat-intelligence signal on top of its own internal vendor-master check, and Intercepta is
that signal.

### Where it's implemented

- `packages/intercepta-adapter/src/client.ts` — the live HTTP client: `scanAddress(address, 'quick-
  scan' | 'toxic-score')`, `scanToken(tokenAddress, chainId)`, `scanMessage(payload)`. Every call sets
  `cache: 'no-store'`, reads `INTERCEPTA_API_KEY` from the environment at call time (never at import
  time, never with a fallback), and sha256-hashes the exact response bytes to
  `.data/intercepta/<sha256>.json` before interpreting them, so any downstream decision can cite the
  precise evidence that justified it.
- `packages/intercepta-adapter/src/schemas.ts` — the `resolvePremise` adapter side:
  `interceptaRisk.fields` exposes `payment.payTo.toxicScore`, `payment.payTo.toxicScoreDeep`,
  `payment.payTo.traitCount`, `payment.token.riskScore`, `payment.token.detectorCount`, and their
  `payer`-side equivalents, all as `bigint | null`.
- `packages/villain-corpus/harness/run.ts`'s optional fourth scenario — a real, key-gated call to
  `scanAddress` against the fraudulent payout address, kept structurally separate from the three
  deterministic core scenarios so a missing key or a live-call failure never affects their pass/fail
  status (CLAUDE.md rule 1/7: never silently skipped, never a mocked fallback).
- `.env.example`'s `INTERCEPTA_API_KEY=` line, and `packages/intercepta-adapter/src/client.ts`'s
  `InterceptaKeyMissingError`, which names the exact env var and signup URL a missing key needs.

### Why it's important to this project — what breaks without it

Remove Intercepta, and this build loses its only genuinely *live*, third-party risk signal — every
remaining truth source (`issuer-oracle`'s vendor fixture) is an honestly-disclosed internal
simulation, not a real external service making a real network call under real sponsor qualification
rules. Concretely: the sponsor track this integration targets explicitly disqualifies mocked API
responses, so a project built only on `issuer-oracle` alone would have nothing to show for this track
at all. More specifically to the product: without Intercepta, "the claimed address doesn't match our
vendor-master record" is the *only* signal available on a payout-address change — there is no way to
independently corroborate that the *new*, claimed address is itself associated with known fraud
infrastructure, which is exactly the kind of corroborating evidence a real AP fraud-review desk would
want attached to a `HELD_FOR_STEPUP` decision before a human signs off on it.

### What it solves

In the BEC/AP scenario specifically: Intercepta closes the gap between "this claim disagrees with our
internal records" (which `issuer-oracle` alone already catches) and "this claim points at an address
independently known to be dangerous" — the second, corroborating fact that turns "our records say
something different" into "our records say something different, *and* the new address the attacker
wants us to pay has its own real reputation for being bad." It is the live-data half of the fraud
picture that no internal vendor-master system, however well-maintained, can provide on its own.

### Honest caveat — the Sui-address limitation

**Intercepta currently cannot screen the Sui-shaped payout addresses used in this demo.** Intercepta's
address-scan endpoints (Quick Scan, Deep Scan) document their address parameter as "ETH address/ENS" —
a 20-byte EVM address or a lowercase ENS name — and Scan Token's `chainId` enum
(`1868, 7777777, 1, 8453, 130, 146, 56, 137, 10, 42161, 480, 42220, 43114, 324, 81457, 59144, 999,
33139, solana, 57073`) contains no Sui id and no Sepolia/testnet id at all. This project settles on
Sui, so every vendor payout address in the fixtures and in the villain-corpus spoofed invoice is a
32-byte Sui address — a shape Intercepta's documented API simply does not accept. This is enforced
structurally in code, not glossed over: `packages/intercepta-adapter/src/client.ts`'s
`parseScreeningSubject` actively rejects a 32-byte Sui address *before* any network call is made, with
an error explaining exactly why, and `packages/villain-corpus/harness/run.ts`'s optional Intercepta
scenario is documented as **expected to fail** for this exact reason, even with a valid API key
present.

**What a production fix would look like:** vendor payout addresses would need to be tracked as (or
linked to) EVM addresses — either by having vendors register an EVM-format payout account directly, or
by maintaining a per-vendor Sui-address-to-EVM-identity linkage the same way the earlier, abandoned
Hostage Protocol design considered linking Sui agent identity to an EVM counterpart. Sui would remain
the settlement and audit-trail layer regardless of this change; only the *screening* leg of the flow
would need an EVM-shaped address to hand to Intercepta. This is stated as an open, real limitation in
`docs/THREATMODEL.md` and in `docs/VERIFY_FINDINGS.md` item 5 — not something this build works around
by, say, encoding a Sui address into a fake EVM shape, which would be exactly the kind of guess this
project's discipline forbids.

---

## Sui

### What it is / what it does

Sui is a Layer-1 blockchain built around an object-centric data model (rather than account-balance
mappings) and the Move programming language, which enforces linear ownership and resource-safety
properties (an object cannot be silently copied or dropped; ownership transfer is explicit) at the
type-system level. Objects can be owned by a single address, shared for concurrent access, or
immutable, and capability-gated functions (a struct with `key` that a caller must hold a reference to)
are the idiomatic way to restrict who can call a sensitive function — there is no separate access-
control-list or role-mapping pattern layered on top; the object itself is the permission.

### Why we chose it for this product

The entire thesis of this project is that safety comes from independent re-derivation and structural
guarantees, not a trusted flag someone could forget to check or a database row someone could edit.
Sui's object model maps onto exactly that requirement for the one place in this system that must never
be replayed: a payment verdict. A `Verdict` on Sui is a real object with a real identity; consuming it
in `settle`/`settle_with_stepup` deletes it from existence. There is no `wasSettled: true` boolean
anywhere to forget to set, and no way for a compromised backend to "un-delete" an object and settle it
twice. Move's capability pattern (`EnforcerCap`) gives the same structural guarantee for *who* can mint
a verdict in the first place: it is not an address check anywhere in the code, it is "you must
physically hold this object" — a narrower, more visible threat surface than a private key that could
leak silently.

### Where it's implemented

- `move/sources/bonded_vault.move` — `EnforcerCap` (minted once, to the publisher, at `init`;
  non-re-mintable); `Verdict` (`proposal_hash`, `policy_hash`, `outcome: u8`, `reason_code: u16`,
  `value_usdc: u64`); `StepUpApproval` (`proposal_hash`); `Vault<phantom T>` (generic over the
  settlement coin type); `mint_verdict`, `mint_stepup_approval`, `new_vault`/`new_and_share_vault`,
  `fund_vault`, `settle`, `settle_with_stepup`.
- `move/sources/bonded_registry.move` — `BondedRegistry { current_policy_hash: Table<address,
  vector<u8>> }`; `commit_policy` (the one-directional, cap-gated write path `enforce()`'s
  stale-policy check ultimately points at).
- `move/tests/bonded_vault_tests.move` and `move/tests/bonded_registry_tests.move` — 12 Move unit
  tests, covering cap-gating, the settle/refuse/held branches, `settle_with_stepup`'s success and
  proposal-hash-mismatch-abort paths, replay (a settled verdict's object id cannot be fetched again),
  and the registry's forward-only overwrite.
- `move/DEPLOYMENTS.md` — the real deployed package id
  (`0xf3d914b39722e1c6c3f0e274d088623c0e050d3125b8f658d48b94498efbf57a`, Sui testnet), the shared
  `Vault<USDSUI>` and `BondedRegistry` object ids, and a live smoke test recording a real mint→settle
  transaction and a real dry-run abort of the `HELD_FOR_STEPUP`-through-`settle` guard.
- `packages/seam/src/types.ts`'s `Verdict.outcome: 0 | 1 | 2` and `ReasonCode` enum are the TypeScript
  side of the exact wire format `bonded_vault.move`'s `CLEARED`/`REFUSED`/`HELD_FOR_STEPUP` constants
  mirror.

### Why it's important to this project — what breaks without it

Remove Sui, and this project loses the only place where "this verdict has been used" is a fact about
the existence of an object on a shared ledger, rather than a fact about the state of a database this
project's own backend controls (and could, in principle, be tricked or compromised into misreporting).
The replay guard specifically depends on it: without an object-consumption model, "don't settle the
same verdict twice" becomes an application-level check (a `usedVerdicts` set, a `settled` boolean
column) — exactly the kind of flag-based guard this project's thesis argues is weaker than a
structural one. The capability-based access control (`EnforcerCap`) would similarly degrade to an
address allowlist check, which is a real control but a categorically different, more traditional one
than "the function literally cannot be called without presenting the object." Without Sui, this
project would also lose its only genuine on-chain audit trail: `VerdictMinted`, `StepUpApprovalMinted`,
and `Settled` events are real, queryable, immutable facts about what was decided and what moved,
independent of anything this project's own servers say happened.

### What it solves

In the BEC/AP scenario specifically: once a human clears a `HELD_FOR_STEPUP` payout-address mismatch
through World, Sui is what makes that approval *count exactly once*. `settle_with_stepup` requires
both the `Verdict` object and a `StepUpApproval` object minted for the *same* `proposal_hash` — an
attacker who somehow captured or replayed an old approval cannot reuse it against a new payment, and
an AP desk that already paid an invoice cannot have that same verdict object settled again by mistake
or by a second, race-condition-triggered call. It is the layer that turns "we decided to pay this
invoice, once" into a fact nobody, including this project's own operators, can quietly duplicate.

---

## World (ID for Agents)

### What it is / what it does

World ID for Agents is a sandbox OIDC identity provider (`sandbox.auth.world.org`) purpose-built for
proving that a real, live human — not a bot, not a replayed session, not a compromised backend acting
alone — is present at a specific moment. It exposes standard OIDC discovery, authorization-code flow
with mandatory PKCE (S256), and RS256-signed ID tokens carrying `sub` (a pairwise, per-relying-party
identifier), `auth_time` (when the human actually proved presence), `acr`/`amr` (assurance level and
authentication method — `https://world.org/oidc/acr/orb-v3` / `["pop"]`, proof of possession, for this
sandbox), with no `userinfo_endpoint` and a five-minute lifetime on both authorization codes and ID
tokens. The `max_age=0` parameter is the mechanism for demanding a transaction's own fresh proof,
bypassing any existing browser session.

### Why we chose it for this product

CLAUDE.md's own hard rule states the project's thesis directly: "the whole thesis of this project is
that safety comes from the stake math [here: the re-derivation math], not a click" — and the *only*
two human-facing buttons this project allows to exist are the World ID mint/verification step and the
Recovery Desk-equivalent step-up, specifically because a sponsor's own track requires demonstrating
that exact human moment. For the BEC scenario, that moment is precise and load-bearing: when a vendor's
payout address changes, `holdOnMismatch` deliberately does *not* auto-refuse (because it might be
legitimate) and deliberately does *not* auto-clear (because it might be fraud) — it requires a human,
right now, for this specific proposal. World is the one sponsor whose entire purpose is proving that
"right now, this specific human, for this specific transaction" fact with cryptographic rigor rather
than a rubber-stamp UI button that means nothing.

### Where it's implemented

- `packages/world-agents/src/flow.ts` — the OIDC mechanics: `discover()` (fetches and validates the
  live discovery document against every property this flow relies on), `buildAuthorizationUrl`
  (PKCE S256, `max_age=0`, `acr_values`), `exchangeCode` (redeems the authorization code at the real
  token endpoint), `verifyIdToken` (verifies the real signature against the live JWKS, checks `iss`/
  `aud`/`exp`/`nonce`/`acr`/`amr`). The `WorldStepUpFlow` class's `initiateStepUp`/`handleCallback`
  orchestrate a proposal-scoped (not agent-scoped) attempt, with single-use state/nonce/code
  enforcement happening atomically before any network call.
- `packages/world-agents/src/stepup-gate.ts` — `decideStepUp`, the pure policy layer on top of an
  already-verified callback: the freshness check (`STEPUP_FRESHNESS_WINDOW_MS`, 5 minutes) and the
  optional `sub_mismatch` check. `fromHeldVerdict` builds a `HeldProposal` directly from the
  enforcer's real `Verdict` object, refusing to proceed if the verdict isn't actually a
  `HELD_FOR_STEPUP` for one of the two recognized hold reasons.
- `packages/world-agents/src/__tests__/world-jwks.test.ts` — fetches the real, live JWKS, reads its
  real key id, and confirms a token signed with a *different* key under that same real `kid` is
  rejected, exercising jose's actual cryptographic verification against real key material rather than
  a fabricated stand-in.
- `apps/console/app/api/stepup/route.ts` — the console's thin wrapper: `POST { proposalHash }` starts
  a real step-up attempt (after re-deriving that the proposal is genuinely held, never trusting a
  client-supplied claim), and `GET` handles the real OIDC redirect callback.
- `.env.example`'s `WORLD_SANDBOX_CLIENT_ID` / `WORLD_SANDBOX_CLIENT_SECRET` / `WORLD_REDIRECT_URI`
  lines — all empty, per CLAUDE.md rule 3 (nothing that signs or authenticates lives in plaintext
  `.env` values in this repo; these are OIDC client credentials, not signing keys, but the same
  "never committed with a real value" discipline applies).

### Why it's important to this project — what breaks without it

Remove World, and `holdOnMismatch`'s entire reason for existing collapses: the mechanism exists
specifically *because* a payout-address mismatch cannot be safely resolved by pure computation alone
(it might be a legitimate bank change) and cannot be safely ignored either (it might be fraud) — it
needs a human decision, and without World there is no sponsor-qualified, cryptographically real way to
prove that decision came from a live, present human rather than a stale session token, a hard-coded
"approved" flag, or a backend that decided to approve itself. Losing World would force this project
into exactly the "human-approval button" anti-pattern CLAUDE.md's own rules forbid everywhere except
this one moment — a button that could mean anything, backed by nothing verifiable. It would also
remove the only place in the whole system where `settle_with_stepup`'s second required object
(`StepUpApproval`) could legitimately come from: without a real, verified fresh-human event to mint it
against, that object would have no honest justification for existing at all.

### What it solves

In the BEC/AP scenario specifically: World closes the gap between "this payout address doesn't match
our vendor-master record" (a fact `issuer-oracle` establishes) and "a human, right now, confirmed this
specific payment should still proceed despite that mismatch" (the fact only World can establish). It
is what lets Bonded avoid the two failure modes a naive system would fall into — auto-refusing every
legitimate bank change (which real vendors do make) or auto-approving every fraudulent one (which
defeats the entire point) — by inserting exactly one, precisely-scoped, cryptographically real human
checkpoint at exactly the moment that actually needs it, and nowhere else.

---

## A note on what's absent: Curvegrid/MultiBaas and ENS

Curvegrid (MultiBaas) and ENSv2 were part of an earlier design iteration — the Commerce Migration
PRD's ticket-scalper-focused plan — and are explicitly out of scope in this build, by the user's own
direction during the pivot to the B2B/BEC use case. Their absence is a deliberate scope decision, not
a technical failure: both were researched thoroughly enough to confirm real, live API contracts
(`docs/VERIFY_FINDINGS.md` items 1 and 2), but neither ships in the AP-automation product this
document describes.
