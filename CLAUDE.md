# CLAUDE.md — Project instructions for Bonded (Commerce Edition)

This file is read automatically by Claude Code at the start of every session in this repo. It exists
so discipline survives contact with a live deadline, across every session, even ones where the PRD
itself isn't open.

**Read `BONDED_PRD.md` in full before writing any code in a new session, and `sponsers.md` for the
sponsor detail.** That is the spec, describing what is actually built, in the present tense, as fact.
This file is the set of rules for *how* to work from it, not a replacement for it.

Sponsors for this build: **Intercepta, World (ID for Agents), Sui.** Curvegrid/MultiBaas is out of
scope — dropped by the user's explicit direction, not by the PRD's own cut order.

---

## The one rule above the others

**Never guess a plausible-looking API/SDK signature for anything marked `[VERIFY]` in the PRD.** If
you don't have a confirmed signature from the actual docs (Sui, World ID for Agents sandbox,
Intercepta), say so explicitly and either fetch the doc or ask, instead of writing code that merely
compiles. A confident wrong guess costs more time than an honest pause.

## Hard rules, no exceptions

1. **No mocked or hard-coded Intercepta responses, ever, in code that runs during the actual demo or
   gets submitted.** The sponsor track explicitly disqualifies mocked API responses. If a live call
   can't be made yet (no key, network down), write it as a visibly failing stub, not a
   silently-succeeding fake one.
2. **Every on-chain USDC amount is a `bigint` or a 6-decimal fixed-point string, never a `number`,
   never `parseFloat`.** `packages/seam/src/money.ts` is the one place this arithmetic lives. If
   you're about to write a float multiplication over money, stop and use the seam helper instead.
3. **Secrets never go in `.env` in plaintext for anything that signs on-chain.** Sui signing goes
   through the Sui CLI keystore, outside the repo; code never reads key bytes.
4. **Don't add a human-approval button anywhere in the primary transaction flow.** The whole thesis is
   that safety comes from independent re-derivation, not a click. The only human-facing button allowed
   is the World ID fresh-verification step-up, and only above the irreversible threshold or on a
   non-refundable item — never on every purchase (PRD D.6, the rubber-stamp argument).
5. **Every refusal or hold carries the actual re-derived value next to the claimed one — never a bare
   claim.** This is what the premise-diff table renders; a `ReasonCode.PREMISE_MISMATCH` with no
   stored comparison is not a complete implementation.
6. **State what's NOT built, in `docs/THREATMODEL.md`, before writing anything else in `docs/`.**
   In particular: the issuer-oracle is a disclosed, controlled fixture standing in for a real primary
   issuer/merchant API (PRD D.4, I.4) — say so plainly, in the first screen, not discovered by a judge.
7. **Never fabricate sponsor data, including in tests.** No pretend Intercepta responses, no
   self-signed World tokens standing in for a real sandbox token. Tests exercise our own logic over
   our own inputs, or run against real on-chain/live state. Anything that needs a key the user hasn't
   provided yet fails visibly; it is never skipped and never faked.

## Working style for this repo

- **Follow the build order in Part D.1 of the migration PRD, not convenience order:** `packages/seam`
  first, `move/` deployed empty second, `packages/enforcer` re-verified against the extended types
  third, before either new adapter is wired in.
- **Commit as you go, one layer per branch** (`feat/seam-types`, `feat/enforcer`,
  `feat/intercepta-adapter`, `feat/issuer-oracle`, `feat/world-agents`, `feat/bonded-vault`,
  `feat/villain-corpus`, `feat/console`). No single end-of-day mega-commit.
- **Write `FEEDBACK/<sponsor>.md` incrementally, the moment you hit friction.**
- **When a test file and the code it tests are both due, write the test first**, especially
  `enforce.test.ts`'s ReasonCode branches and `bonded_vault_tests.move`'s replay/capability checks.
- **Do not run `git push`.** Commit locally; the user pushes once they've set up the new remote.

## When something in the PRD looks wrong once you're actually building

Say so directly, in the session, before writing code around it. Point to the specific part of the PRD
that seems off and why, rather than quietly reinterpreting the spec to make the code you already
wrote correct.

## What "done" means for any single task in this repo

Not "compiles." Match it against the specific row in Part G (Testing Matrix) or Part H (Sponsor
Qualification Matrix) of the migration PRD that the task exists to satisfy, and say which row it is
when you report back that it's done.
