# Contributing

Bonded is a hackathon build (ETHOnline 2026) with a hard rule: **every sponsor
integration is real or it is cut and disclosed.** Nothing in this repo is
allowed to present a mocked API response, a fabricated benchmark number, or a
simulated deployment as if it were live.

## Before you open a PR

- `pnpm typecheck` and `pnpm test` must pass.
- Contract changes: `pnpm contracts:test` (Foundry) must pass, including the
  fuzz tests over settlement ordering and budget accounting.
- If you touch `packages/seam`, stop — it is frozen after the `seam-v1` tag.
  Any change here is a breaking change to every other package and needs
  explicit discussion first.
- If you touch `packages/enforcer/src/enforce.ts`, the six-step order
  (policy hash → forbidden action → premises → budget → irreversible
  threshold → clear) must not be reordered. Add a test for any new branch.

## Commit discipline

- One layer/concern per commit. Don't bundle an enforcer change with a
  console UI change.
- `FEEDBACK/*.md` entries land as their own commits as issues are found —
  not as a single end-of-build dump.
- Never commit `.env`, `secrets.env`, `secrets.env.enc`, or any real API key,
  RPC credential, or private key. See `.env.example` for the expected shape.

## Reporting a bug against a sponsor SDK

Reproduce it first. `FEEDBACK/THEGRAPH.md`, `FEEDBACK/ARC.md`, and
`FEEDBACK/CHAINLINK.md` only take findings that have been independently
reproduced against the live SDK/API, with the exact command or request that
triggers them.
