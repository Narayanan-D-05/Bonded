## What this changes and why

## Layer(s) touched

- [ ] `packages/seam` (frozen — explain why this is necessary)
- [ ] `packages/enforcer`
- [ ] `packages/standardized`
- [ ] `packages/authority`
- [ ] `contracts/`
- [ ] `subgraph/`
- [ ] `apps/console`
- [ ] `packages/attack-corpus`
- [ ] docs / FEEDBACK

## Checks

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm contracts:test` passes (if `contracts/` touched)
- [ ] No mocked sponsor SDK response introduced — real integration or clearly
      labeled as not-yet-live, per `CONTRIBUTING.md`
- [ ] No secret, RPC credential, or private key committed
