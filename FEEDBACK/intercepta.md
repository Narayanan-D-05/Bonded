# Intercepta (Web3 Antivirus) — builder feedback (written as it happens)

Package: `packages/intercepta-adapter`. Base observed live: `https://api.web3antivirus.io`.

## 2026-09-26 — Building `packages/intercepta-adapter` fresh from the Commerce Migration PRD

- **The Migration PRD's own D.5 code sketch is wrong on three separate points, all marked
  `[VERIFY]` in the PRD text itself, and none of the three survive contact with the real docs or a
  live call:**
  1. `INTERCEPTA_BASE = 'https://api.web3antivirus.io'` is missing the required
     `/api/public/v2/extension` prefix that every real endpoint path sits under. Confirmed against
     `docs/reference/intercepta-api-docs.md`'s own curl examples AND a live unauthenticated probe
     today (see below) — the prefixed path is what returns a real 403 from Intercepta's server; the
     bare host by itself is not a working endpoint for any of these calls.
  2. `scanToken()`'s sketched return shape, `{ isLookalike: boolean; riskScore: number }`, has no
     `isLookalike` field anywhere in the real `TokenRiskAnalysisV2Response` schema. The real schema
     (confirmed via the OAS embedded in the reference pages, see `docs/VERIFY_FINDINGS.md` item 5)
     has `riskScore`, `riskLevel` (`neutral|low|medium|high`), `category`, `trust`, `action`, and a
     `detectors[]` array with `{code, description}` — a materially richer and differently-shaped
     response than the PRD guessed. I did not port `isLookalike` into the adapter; inventing a field
     the docs don't show would have been exactly the kind of guess CLAUDE.md's rule 1 forbids.
  2. `scanAddress()`'s sketched return shape, `{ sanctioned: boolean; scamExposure: boolean;
     riskScore: number }`, also doesn't exist. Both Quick Scan and Deep Scan actually return the same
     `ToxicScoreShortResponseV2` shape: `{ toxicScore: number; traits: ToxicScoreTraitV2[] }`, where
     `traits[].name` is a 15-value documented enum (`sanction_address`, `known_scammer`, etc.) — a
     list of typed events, not two booleans plus a score.
- **`toxicScore`'s and `riskScore`'s numeric ranges are still UNCONFIRMED.** Neither field has a
  documented min, max, or direction (VERIFY_FINDINGS item 5, re-confirmed by re-reading the same
  pages myself for this task). Per the task brief and CLAUDE.md's `[VERIFY]` rule, I did NOT invent a
  "hard flag" threshold anywhere in this package — `schemas.ts` passes the raw integer score straight
  through as a `bigint`, with the range gap stated in a comment at the point of use
  (`toBigIntScoreOrThrow` in `src/schemas.ts`). Whoever wires a policy threshold against
  `payment.payTo.toxicScore` needs a real keyed call against the pinned test addresses first, to
  learn what "high risk" actually looks like as a number.
- **Scan Message does not fit this migration's payment shape.** Its documented `messageType` enum is
  the Permit/Permit2 family (`Permit, PermitSingle, PermitBatch, PermitForAll, PermitTransferFrom,
  PermitBatchTransferFrom`). x402's EVM `exact` scheme signs an ERC-3009 `TransferWithAuthorization`
  EIP-712 message, which is not in that list. I built `scanMessage()` faithfully to the documented
  request/response schema (it's a real, documented endpoint, not a guess), but deliberately did NOT
  wire it into `interceptaRisk.fields` — using it on the actual x402 payment payload would be
  adapting to a fit I can't confirm, which is exactly what this task asked me not to do.
- **Scan Token's `chainId` enum has no Sui id and no Sepolia/testnet id.** The documented enum is
  `1868, 7777777, 1, 8453, 130, 146, 56, 137, 10, 42161, 480, 42220, 43114, 324, 81457, 59144, 999,
  33139, solana, 57073`. This migration settles on Sui, so a token that only exists there cannot be
  scored by this endpoint at all — this is the same gap `docs/THREATMODEL.md` and
  `docs/VERIFY_FINDINGS.md` item 5 already flag for address screening; it turns out to apply to
  token screening too, and just as completely.
- **Live probe, 2026-09-26, no key set:** all three endpoints answered a real, identical
  `403 {"status":403,"response":"This authentication key is incorrect or doesn't exist","errors":[...]}`
  for `quick-scan`, `toxic-score`, and `token-intelligence/token/{address}/risks`. Routing runs before
  auth (a 404 on an unknown path would look different), so this confirms all three paths are live and
  correctly spelled, exactly matching the same finding the abandoned Hostage-era client recorded on
  2026-09-25 for the two address endpoints — reproduced here independently for Scan Token too. See
  `scripts/probe.ts`'s output in the task report for the full bodies.
- **`resolvePremise`'s return convention had to be resolved before `schemas.ts` could be written at
  all.** The Migration PRD D.5 sketch shows field functions returning
  `Promise<string | number | boolean | undefined>`. But `packages/enforcer` — which didn't exist when
  this package's work started, and appeared mid-task, presumably built by someone else in parallel —
  actually implements `resolvePremise(def, at): Promise<bigint | null>`, matching the ORIGINAL
  Implementation PRD's D.3 convention, not the Migration PRD's D.5 sketch. `schemas.ts` follows the
  confirmed, already-written convention. This means every categorical Intercepta field
  (`riskLevel`, `category`, `trust`, `action`, `riskGroup`) is NOT exposed through `resolvePremise` at
  all — the seam's `PremiseOp` set (`gte`/`lte`/`eq`/...) is built for bigint comparison, and inventing
  an ordinal encoding for a string enum (deciding `high` = `3n`, say) would be exactly the kind of
  guessed-severity decision CLAUDE.md's `[VERIFY]` rule forbids. This is a real, disclosed gap in the
  premise vocabulary, not a silent omission — stated here and in the package report so it can be
  designed properly once the enforcer's premise definitions are actually written against Intercepta.
- **The `.env` line is genuinely still missing.** `INTERCEPTA_API_KEY` is not set anywhere in this
  repo's `.env` as of this writing (checked presence only, never printed). Neither is a pinned
  known-risk test address on hand from Intercepta's Discord. Both are still owed by the user before
  this package's live "screen a real mainnet address before payment" qualification can actually run —
  everything up to that point (endpoints, schemas, error handling, cache discipline) is built and
  tested against the real, documented API surface.
