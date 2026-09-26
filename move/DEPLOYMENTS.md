# Deployments — `bonded` Move package

Public on-chain ids only. No keys, no keystore contents.

**2026-09-26 — the deployment below is abandoned.** It was the Hostage Protocol's `bond_vault`
package, now superseded by the Commerce Edition (`BONDED_COMMERCE_MIGRATION_PRD.md` D.7:
`bonded_registry` + `bonded_vault` + `verdict`). Left on testnet as a harmless immutable artifact; see
`FEEDBACK/sui.md`. The address that funded it (`0x916c…f05a`) is reused for the new deployment below
this line once it lands.

## Abandoned — Hostage Protocol v1 (open / join / settle / refund)

| Item | Value |
|---|---|
| Date | 2026-09-25 |
| Network | Sui testnet (chain id `4c78adac`, protocol version 137) |
| Toolchain | `sui 1.73.1-ff1fe0ec4551`, framework pinned at `718ae563` (see `Move.lock`) |
| Publisher (active address) | `0x916c7accd3308e4a8ec896b51b2a0bbcd510abff0579c059455b7e30d147f05a` |
| **Package id** | `0x990acf4456f98cedde25ba5c2b6e32103386bf8391c4ff3d2c32709e35c50d43` |
| **UpgradeCap** | `0xbb5ec61834ccecad1f9477dfabd1f66d79a2d7968a3af6d2cd44f321a788e894` (owned by publisher) |
| **EnforcerCap** | `0xec1d6a63a842b1314eb3c2246c8ce601c55271281a9083d0255d5e7f11bf6332` (owned by publisher) |
| Publish tx digest | `7yeoyGje62gn52SEt61zCh8HSSTfhXR4C1RXVo4wgsNk` |
| Explorer | https://suiscan.xyz/testnet/tx/7yeoyGje62gn52SEt61zCh8HSSTfhXR4C1RXVo4wgsNk |
| Dry-run estimate | 29,648,800 MIST (0.0296 SUI, includes CLI buffer) |
| Gas actually spent | computation 1,000,000 + storage 27,648,800 − rebate 978,120 = **27,670,680 MIST (0.0277 SUI)** |

Types, for clients:

- `0x990acf4456f98cedde25ba5c2b6e32103386bf8391c4ff3d2c32709e35c50d43::bond_vault::Bond<T>` (shared)
- `0x990acf4456f98cedde25ba5c2b6e32103386bf8391c4ff3d2c32709e35c50d43::bond_vault::EnforcerCap`
- Events: `BondOpened`, `BondJoined`, `BondSettled` (outcome 0), `BondRefunded` (outcome 3).
  `vector<u8>` fields (`tx_ref`, `delivery_commitment`) arrive **base64-encoded** in event JSON.

`Published.toml` (written by the CLI) records the same package id / UpgradeCap and must be kept:
Phase 3 `slash` is added by `sui client upgrade` against this UpgradeCap, and the `Bond` struct
layout is frozen by this publish.

### Live smoke test (shared-object deletion on the real network)

Verifies on the live network (not only in `test_scenario`) that a shared `Bond<T>` can be taken by
value and deleted (`shared_object_deletion = true` on testnet, protocol 137). Coin type
`0x2::sui::SUI`, price 1,000 MIST, 10500 bps, stake 1,050 MIST, seller `@0xcafe` (never joined).

| Step | Digest | Result |
|---|---|---|
| `open` | `DMmJAxN94wNFJcYmSAsUXzdvGfwkWXZZS7QF3g4cGKC5` ([explorer](https://suiscan.xyz/testnet/tx/DMmJAxN94wNFJcYmSAsUXzdvGfwkWXZZS7QF3g4cGKC5)) | Bond `0x5c9e1f813800ee3509aca169ee69e2ee60a360017953805594b121e737d5d575` created, `Shared`; `BondOpened` emitted with `required_stake = 1050` |
| `refund` dry-run before deadline | — (dry run, no gas) | `MoveAbort(.. "refund" .., 12)` = `EDeadlineNotReached` |
| `refund` after deadline | `GFgw7ikuFb6Xv4M2ihTqxvdQDsR2LTXko9bwqiYbUf34` ([explorer](https://suiscan.xyz/testnet/tx/GFgw7ikuFb6Xv4M2ihTqxvdQDsR2LTXko9bwqiYbUf34)) | Bond listed under `deleted`; one 2,050 MIST coin (payment + stake) returned to the buyer; `BondRefunded` outcome 3, reason 0, `was_locked = false` |

Net gas for both: 3,867,480 − 831,144 = 3,036,336 MIST (the refund's storage rebate exceeds its cost).
**Total SUI spent by this deployment work: 30,707,016 MIST (0.0307 SUI).** Balance before
1,110,406,044 MIST; after 1,079,699,028 MIST (including the returned 2,050 MIST coin).

Not exercised on-chain: `join` and `settle` (they need a second funded address as seller; covered
by the 34 Move unit tests instead).
