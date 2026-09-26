# World (ID for Agents) — builder feedback (written as it happens)

Sandbox: `sandbox.auth.world.org`. Package: `@bonded/world-agents`, adapted from the
now-deleted `identity/` (built for the abandoned Hostage Protocol's Recovery Desk).

## 2026-09-26 — Migrating the Recovery Desk into a proposal-scoped step-up gate

- **The OIDC mechanics really did carry over with zero changes**, exactly as Migration PRD
  D.6 predicted ("The underlying OIDC mechanics ... are exactly what the Commerce Edition's
  step-up needs too"). `identity/src/world-flow.ts` — discovery validation, PKCE, the
  authorization URL, token exchange, JWKS verification — ported into
  `packages/world-agents/src/flow.ts` with no logic changes at all, only doc-comment
  updates. The actual rewrite was entirely in the *orchestration* layer
  (`identity/src/recovery-desk.ts` → `stepup-gate.ts` + the stateful half of `flow.ts`):
  swapping an agent-keyed `LOCKED`/owner-binding state machine for a proposal-hash-keyed
  one-shot decision. That's a strong, checkable instance of the PRD's own D.2 argument
  ("you can put the diff next to the original and show it's additive, not structural") —
  here it's the opposite shape: the low-level file is *unchanged*, and only the
  policy-carrying file needed a real rewrite.

- **Re-probed the live discovery document and JWKS on 2026-09-26, immediately before
  writing `flow.ts`: zero drift from `docs/VERIFY_FINDINGS.md` items 3a/3b.** Same issuer,
  same four endpoints, same single scope `openid`, same `code_challenge_methods_supported:
  ["S256"]`, same `id_token_signing_alg_values_supported: ["RS256"]`, same
  `acr_values_supported: ["https://world.org/oidc/acr/orb-v3"]`. The JWKS still publishes
  exactly one RSA-2048 key (`kid: SjxoYTY6TKyO9wDOz9VmG4ze3tJsvwsPE5zgkOqqwAo`). Nothing here
  needed re-verifying against a stale assumption.

- **A design question the PRD's sketch leaves genuinely open, and worth writing down since
  we had to decide it ourselves:** does the step-up need to check the verifying human's
  `sub` against anything bound earlier? The old Recovery Desk required it (it was gating an
  *agent's owner identity*). PRD D.6 gates a *purchase* (`proposalHash`) instead, and its own
  text never mentions a `sub` check — only freshness ("the fresh World check gates only the
  moment a proposal crosses `irreversibleAboveUSDC`..."). We decided NOT to require it: any
  human who freshly clears World's liveness/uniqueness bar for this specific attempt
  (bound by `nonce`, not by `sub`) satisfies the gate; `boundSub` on `HeldProposal` is kept
  as an **optional** field for a future policy that might want operator continuity, but
  `decideStepUp` never requires it. Documented at length in `stepup-gate.ts`'s module
  header so this isn't a silent scope decision.

- **`packages/seam`'s Migration PRD D.2 extension landed mid-build, while this package was
  already underway** — `ReasonCode.IRREVERSIBLE_UNCONFIRMED` (value 6) and the `Verdict`
  shape (`proposalHash`, `policyHash`, `outcome: 0|1|2`, `reasonCode`) appeared in
  `packages/seam/src/types.ts` partway through writing `stepup-gate.ts`. Worth flagging for
  anyone reading commit history out of order: an earlier draft of this file locally
  re-declared `HoldReason` as a string literal because seam had no `ReasonCode` export yet
  at the time this package's build started; once seam caught up, `stepup-gate.ts` was
  updated to import `ReasonCode` directly and gained `fromHeldVerdict(verdict, boundSub?)`
  to build a `HeldProposal` straight from the enforcer's real `Verdict` object rather than a
  hand-assembled one. No guessed shape ever shipped — the placeholder was a local literal
  type, never a fabricated import.

- **Testing a real rejection without fabricating a real approval.** CLAUDE.md rule 7 forbids
  self-signed World tokens standing in for a real one. The sharpest test that stays on the
  right side of that line: fetch the *real* live JWKS, read its real `kid`, build a JWT with
  World-shaped claims but sign it with a locally generated RSA key (never claimed to be
  World's), set the header's `kid` to the *real* key's id, and confirm `verifyIdToken`
  rejects it — this exercises jose's actual cryptographic signature check against real key
  material, not just "no matching kid" bookkeeping. `src/__tests__/world-jwks.test.ts`. It
  never asserts `verified`, only `rejected`.

- **Two of the intake-path unit tests end up making one real (uncredentialed) POST to the
  live token endpoint** (`replayed_code`, and the ATTEMPT_TTL boundary test) — a garbage
  authorization code against a fixture client id, which the real sandbox correctly refuses
  as an OAuth error. This wasn't the original plan (the intent was for those tests to stay
  fully offline), but once `initiateStepUp`/`handleCallback` are coupled functions that do
  intake-check-then-exchange in one call, there was no seam to stop before the network call
  without adding test-only hooks. Given the project's own "no mocking" discipline, a real
  call that's expected to fail felt more honest than adding a fake seam just to avoid it —
  but flagging this as a design tradeoff, not something discovered and hidden.

- **No credentials exist yet** — `WORLD_SANDBOX_CLIENT_ID`/`_SECRET`/`WORLD_REDIRECT_URI` are
  all empty in the repo's `.env` (confirmed only by checking *whether* they're set, per
  CLAUDE.md — their values were never read or printed). `scripts/world-live.ts` was run once
  in this state and correctly exited 1, naming exactly those three variables, before opening
  any socket or making any network call. The full live redirect → World app → callback →
  `StepUpApproval` path (PRD Part E steps 5–6) is unverified until the user completes portal
  registration, picks a tunnel, and gets the sandbox World ID app onto a phone.
