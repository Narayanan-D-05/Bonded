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

## Not yet built (updated as phases complete)

- `packages/enforcer` — being rebuilt from the Implementation PRD's D.2 spec (git history for the
  original ETHOnline version was lost; see FEEDBACK/sui.md).
- `move/` — the Hostage-era `bond_vault` package (`0x990acf44…0d43` on Sui testnet) is abandoned;
  a fresh `bonded_registry` + `bonded_vault` + `verdict` package, matching PRD D.7, is pending.
- `packages/intercepta-adapter` — being adapted from the Hostage-era live client.
- `packages/world-agents` — being adapted from the Hostage-era World OIDC flow.
- `packages/issuer-oracle` — new, not yet built.
- `packages/villain-corpus` — the scalper ticket page and bait-and-switch checkout; not yet built.
  (Named differently from the PRD's `packages/attack-corpus` because that name is already used by the
  original ETHOnline villain, whose `results.json` is a protected artifact this project never edits.)
- `apps/console`'s `/shop` screen and the World step-up route — not yet built.
