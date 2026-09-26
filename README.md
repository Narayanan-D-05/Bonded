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

**Verified live on 2026-09-26 (testnet / sandbox):**
- Intercepta: the spoofed globex invoice was refused by a live Deep Scan of the OFAC-listed Lazarus
  address (toxicScore 100, five risk traits); the clean payees screened with zero traits.
- World ID for Agents + Sui: a real person approved the genuine globex bank change; the vendor record
  was updated, the invoice re-checked and paid: 8,450 USDSUI, digest
  [`6RGhLEKA…Th4G`](https://suiscan.xyz/testnet/tx/6RGhLEKACfW2i9FRf6ZZJRXBjyL7bxynae5GWus1Th4G).

**Stated plainly:**
- Not yet run live: halcyon's `settleWithStepUp` path, and the Xero source (needs Xero credentials).
  Without `INTERCEPTA_API_KEY` the screened invoices fail closed (`REFUSED` /
  `PREMISE_UNRESOLVABLE`), never pass.
- The payment rail is an AP agent paying a vendor invoice, settled on Sui. It is not x402: no x402
  facilitator supports Sui (see `docs/VERIFY_FINDINGS.md`).
- Intercepta screens the EVM identity the payee *claims*, not the Sui address the money goes to. The
  link is asserted by the invoice, backed by a hard-refuse check that the claimed identity matches the
  vendor's registered one.
- The vendor master is still the disclosed fixture by default. The spoofed-invoice page isn't hosted
  publicly. There's no policy compiler, and the World identity isn't linked to a Sui account.
- Opening an invoice detail page triggers the agent's POST, which pays if `CLEARED`.

Full detail in `docs/THREATMODEL.md`.

## Sponsor tracks

### Intercepta — Safe Agent Payments

**Where the API is called:**
- [`packages/intercepta-adapter/src/client.ts`](packages/intercepta-adapter/src/client.ts): the live
  HTTP client (`scanAddress` → Quick/Deep Scan, `cache: 'no-store'`, raw response sha256'd and stored
  as evidence under `.data/intercepta/`).
- [`packages/intercepta-adapter/src/schemas.ts`](packages/intercepta-adapter/src/schemas.ts): the
  `payment.payTo.traitCount` field the enforcer checks.
- [`apps/console/lib/ap-policy.ts`](apps/console/lib/ap-policy.ts): the policy that screens the payee
  *before* the payout-address check, so a flagged payee is refused, never held for a human.
- [`apps/console/lib/payment.ts`](apps/console/lib/payment.ts): runs the check before any Sui
  settlement is signed; a missing key or failed call refuses the payment.

**Feedback on the API:**
- Time to first call: an unauthenticated probe returned a real 403 within minutes; the first keyed Deep
  Scan worked on the first request once the key existed.
- What confused us: the OAS marks `txsCount` required on every trait, but live responses omit it on
  some traits (`known_scammer`, `sanction_address`, `blacklist`); our strict parser rejected the first
  real response until we relaxed it. `risk` is fractional (0.54) though the docs don't say so.
- What was missing: a documented range and direction for `toxicScore`/`risk`, so we had to decide on
  trait presence instead of a score threshold.
- Also missing: Sui support. Our payouts settle on Sui, so we screen the payee's EVM identity instead.

### World — World ID for Agents

**The trust moment:** a vendor's payout address changed, or an invoice is over $10,000. Only then does
Bonded ask a person for a fresh World ID verification; routine invoices never do.

**Complete journey:** verification request (`/stepup`) → person completes World ID → the backend
validates the ID token against World's live JWKS
([`packages/world-agents/src/flow.ts`](packages/world-agents/src/flow.ts)) → the protected action
runs: the vendor record is updated and the invoice is paid on Sui
([`apps/console/lib/payment.ts`](apps/console/lib/payment.ts)). The client secret never leaves the
server.

**Unsuccessful path:** cancel or deny on World's page, or let the attempt expire. The console shows
the reason and confirms from the records that no payment was made and the vendor record was not
changed ([`apps/console/app/stepup/page.tsx`](apps/console/app/stepup/page.tsx)). Distinct reasons
include `access_denied`, `state_mismatch`, `replayed_code`, `token_expired` and
`stale_authentication` (older than 5 minutes).

**Integration debrief:**
- Time to first success: the OIDC flow was built and tested against the live discovery document and
  JWKS the same day; the first real approval landed once a client was registered and an HTTPS tunnel
  was running.
- Friction: redirect URIs must be exact HTTPS, so local development needs a tunnel; behind the tunnel
  the app computed `https://localhost:3000` for its own redirect until we used the registered origin;
  the sandbox was slow from our network at times (3–11 s responses against a 10 s timeout).
- Missing documentation: where to get the sandbox app (now moot, since proofs are mocked), and what
  `account_not_eligible` requires from the user.
- The one improvement with the greatest impact: an official localhost or loopback redirect for
  sandbox clients, which would remove the tunnel from the dev loop.

### World — IDKit

**The trust moment:** the *vendor side* of a bank change. Business Email Compromise works by
getting a payer to accept a new bank account for a real vendor. Until now only the payer's side
was checked, so an attacker's email could still request the change. Now a vendor's bank-change
request is only on file if the person submitting it verifies with World ID through IDKit, and the
AP controller's World-ID-for-Agents approval of a held bank change (`PREMISE_HELD_FOR_REVIEW`) only
succeeds when a matching IDKit-verified request exists. Two World products, two different people,
two different jobs: the vendor's representative proves who they are (IDKit); the payer's
controller freshly approves the payment (World ID for Agents).

**Credential choice: `passport` (NFC passport, credential 9303).** Changing where money goes is a
financial-identity event: the question is which accountable person asked for it. Proof of Human
proves a unique live human but links to no identity document. Selfie Check is documented as
"medium-assurance" with no strict one-person-one-account guarantee. The NFC passport credential is
issued to one World ID per document, so it's the lowest assurance level backed by a government
document. That makes it the minimum sufficient choice, and it still reveals no document data to us.
**What we can demo:** the staging Simulator only implements World ID 3.0 levels. On it, the same
`passport` request completes through the preset's legacy Document fallback, so the recorded proof
is a 3.0 `document` (or `secure_document`/`orb`) proof, and the record says exactly which one. In
production, with the real World App, the 4.0 `passport` item (issuer schema 9303) is what's
accepted. We don't claim a 4.0 passport proof until one has been run.

**Full flow:**
1. The AP agent proposes [`inv-halcyon-bank-change`](apps/console/lib/enforce-deps.ts) ($6,300.00:
   halcyon's registered EVM identity, a new payout address). The live Intercepta screen passes, and
   the payout mismatch holds it as `HELD_FOR_STEPUP / PREMISE_HELD_FOR_REVIEW`.
2. The vendor opens [`/vendor/bank-change`](apps/console/app/vendor/bank-change/page.tsx), picks the
   vendor, and enters the new Sui payout address and EVM identity.
3. [`/api/idkit/rp-context`](apps/console/app/api/idkit/rp-context/route.ts) signs the request
   server-side with `signRequest` (the signing key never reaches the browser). It also returns the
   `signal` it built: `bonded-vendor-bank-change:v1|vendorId|payout|evm`.
4. The `IDKitRequestWidget` runs with `passport({ signal })`. Its result goes to
   [`/api/vendor/bank-change`](apps/console/app/api/vendor/bank-change/route.ts), which:
   - rebuilds the signal from the submitted fields;
   - checks action, environment, credential and every `signal_hash`;
   - forwards the result as-is to `POST https://developer.world.org/api/v4/verify/{rp_id}`;
   - only on success, appends the verified request (vendor, addresses, credential, nullifier,
     verifiedAt) to the gitignored `.data/vendor-bank-change-requests.json`
     ([`lib/idkit.ts`](apps/console/lib/idkit.ts)).
5. The AP controller opens `/stepup`, which shows whether the vendor's verified request matches,
   then completes World ID for Agents. [`lib/payment.ts`](apps/console/lib/payment.ts) checks the
   gate. With a match, it writes the new address to the vendor master, re-runs `enforce()`, and the
   invoice clears and settles on Sui.

**Alternative paths** (each is visible and records nothing):

| Path | Where | What the user sees |
|---|---|---|
| Cancelled in World ID | client (`cancelled`, `user_rejected`) | "Cancelled … nothing was recorded" |
| Credential unavailable (no passport or document credential) | client (`credential_unavailable`, `world_id_4_not_available`) | "Credential unavailable" |
| Proof made for a different address | server `signal_mismatch` | refused before World is asked |
| Wrong action or environment, or a non-passport credential | server `action_mismatch`, `environment_mismatch`, `credential_not_accepted` | refused before World is asked |
| World rejects the proof | server `verify_rejected` (World's `code: detail`) | shown as returned by World |
| World unreachable | server `verify_unreachable` | nothing recorded |
| Same request submitted twice | server `duplicate_request` | the first record stands |
| Missing or malformed env | server `missing_env` (names the variables) | no request is signed |
| **Controller approves with no matching vendor request** | `completeStepUp` → `no_verified_vendor_request` | `/stepup` shows the reason and confirms from the ledger and the vendor-master log that no payment and no vendor-record change happened |

**Nullifiers.** A nullifier is fixed per person per action ("the same person verifying the same
action always produces the same nullifier"), and World ID 4.0 uniqueness proofs are one-time per
action per user. A vendor may legitimately change banks twice, so we don't reject a repeated
nullifier outright. Instead we reject a replay of the same request (same action, nullifier *and*
signal hash) and show the nullifier to the controller as a stable pseudonym of the verified person.
If the Portal action allows only one verification per person, a second request from the same
person fails visibly at World.

**What this does NOT prove:** that the verified person works for the vendor. Representative
enrollment (binding a nullifier to a vendor at onboarding) isn't built; see
[`docs/THREATMODEL.md`](docs/THREATMODEL.md). The controller still calls the vendor on the number
on file.

**Integration debrief** (from this build; the success path hasn't been run live yet, so there's no
time-to-first-success figure):
- Time to first success: not yet measured. The server, widget and gate build and pass their tests.
  The first real proof is waiting on the RP signing key and a Simulator run.
- Friction:
  - Which credentials the Simulator can complete is undocumented; we read its JS bundle to find it's
    3.0-only.
  - The passport preset's Document fallback, and the fact that it forces `allow_legacy_proofs` on,
    are only visible in the Rust source.
  - The docs conflict on whether v4 actions must be pre-created.
  - Whether the v4 verify endpoint enforces per-action max verifications isn't stated.
  - Enforcing the `signal` server-side has no how-to (`hashSignal` lives in a `/hashing` subpath,
    and World returns unpadded hashes such as `0x0`).
- Missing docs: a per-environment credential matrix, and test vectors for the verify endpoint (RP
  signatures have them).
- The one improvement with the most impact: a Simulator or sandbox that issues World ID 4.0
  credentials, including Passport. Today you can request the right credential but only demo its
  legacy fallback.

Full notes: [`FEEDBACK/world.md`](FEEDBACK/world.md).

### Sui — DeFi & Payments

A capital allocator for accounts payable. The Move package
([`move/sources/`](move/sources/)) holds the funds in a shared `Vault<USDSUI>`. A payment can only
move money by consuming a one-use `Verdict` object minted with the enforcer's capability; a held
payment additionally needs a `StepUpApproval` for the same proposal. The TypeScript layer
([`packages/sui-settlement`](packages/sui-settlement)) submits the real transactions automatically.
Live transactions are listed in [`move/DEPLOYMENTS.md`](move/DEPLOYMENTS.md).

## Keys you need to add

Put these in `.env` (copy `.env.example`; `.env` is never committed). Sui signing uses the Sui CLI
keystore, not `.env`.

| Key | Where to get it | What it unlocks |
|---|---|---|
| `INTERCEPTA_API_KEY` | intercepta.io/ethglobal | The live screen (globex and halcyon invoices, villain-corpus scenario 4) |
| `WORLD_SANDBOX_CLIENT_ID`, `WORLD_SANDBOX_CLIENT_SECRET`, `WORLD_REDIRECT_URI` | The World sandbox portal. The redirect URI must be HTTPS, so expose the console through a tunnel | The step-up, and with it `settleWithStepUp` and the bank-change approval |
| `WORLD_IDKIT_APP_ID`, `WORLD_IDKIT_RP_ID`, `WORLD_IDKIT_ACTION`, `WORLD_IDKIT_SIGNING_KEY`, `WORLD_IDKIT_ENVIRONMENT` | The World Developer Portal (developer.world.org): app, RP and signing key; an action in the same environment (`staging` for the Simulator) | The vendor bank-change request (`/vendor/bank-change`), which a held bank change now requires |
| `VENDOR_MASTER_SOURCE=xero`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` (optional `XERO_TENANT_ID`) | A Xero Custom Connection against the Demo Company (free for development) | The real accounting system. Then run `pnpm --filter @bonded/issuer-oracle xero:setup`, and `xero:check` to read it back |

Also get the pinned known-risk test addresses from Intercepta's Discord, to confirm what a flagged
address returns before relying on the screen. Note: re-running `xero:setup` reverts an approved bank
change in Xero.
