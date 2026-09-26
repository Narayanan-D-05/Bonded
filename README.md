# Bonded — Commerce Edition

Your shopping agent trusts whatever the page says. This checks.

An enforcer that never reads the prompt independently re-derives the price, the event status and the
seller's authorization right before an agent's payment settles — against Intercepta's live risk API
and a disclosed reference issuer-oracle — and refuses on mismatch. Anything irreversible pauses for a
fresh World ID verification instead of an autonomous signature.

**Spec:** [`BONDED_COMMERCE_MIGRATION_PRD.md`](BONDED_COMMERCE_MIGRATION_PRD.md) (migrating
[`BONDED_IMPLEMENTATION_PRD.md`](BONDED_IMPLEMENTATION_PRD.md)) · **Working rules:**
[`CLAUDE.md`](CLAUDE.md) · **What is and isn't built:** [`docs/THREATMODEL.md`](docs/THREATMODEL.md)

Sponsors: **Intercepta · Sui · World (ID for Agents).**

## Status

This repository is mid-rebuild on the Commerce Edition (ETHGlobal Tokyo 2026), migrated from an
earlier Hostage Protocol design that is no longer part of this project. `docs/THREATMODEL.md` is the
authoritative list of what exists; the full README — sponsor-by-sponsor proof links, setup, and the
demo script — lands once the build order in Migration PRD Part D.1 completes.
