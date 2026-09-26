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

---

## Commerce Edition — `bonded_vault` + `bonded_registry` (PRD D.7 / H.3)

| Item | Value |
|---|---|
| Date | 2026-09-26 |
| Network | Sui testnet (protocol version 137) |
| Toolchain | `sui 1.73.1-ff1fe0ec4551`, framework pinned at `718ae563` (unchanged from the abandoned deployment; see `Move.lock`) |
| Publisher (active address) | `0x916c7accd3308e4a8ec896b51b2a0bbcd510abff0579c059455b7e30d147f05a` |
| **Package id** | `0xf3d914b39722e1c6c3f0e274d088623c0e050d3125b8f658d48b94498efbf57a` |
| **UpgradeCap** | `0x0cd4a49fcd88aedca2f27ad3185a4cc5d6d185a1039764f82f33959136afea01` (owned by publisher) |
| **EnforcerCap** | `0x60302c2c5682c685daf794b1acf0114bbcfea1d5873066d2860654b1ea5f375d` (owned by publisher) |
| **Vault\<USDSUI\>** (shared) | `0x1c828f5496dfb9200c50f7fcc932cb0edb477265b58978036f4b77018e4dd433` |
| **BondedRegistry** (shared) | `0x107a77efbd5ab5ba91d4ec1104205e254a14365484d694ec72a615bea2b912a5` |
| Settlement coin `T` | `0x832f93729a8b1dfe9dd8067536dfa35231cf019f9401afe04a398df6d18c54cb::usdsui::USDSUI` (6 decimals — see `docs/VERIFY_FINDINGS.md` item 6; **not** the other, unrelated same-named `0x8f838f20…f239::usdsui::USDSUI` also sitting in this wallet, see `FEEDBACK/sui.md`) |
| Publish tx digest | `2SornYLMtyhaH3X7DbMxVra4RGMpYxrVCqri5mqa32zw` |
| Explorer | https://suiscan.xyz/testnet/tx/2SornYLMtyhaH3X7DbMxVra4RGMpYxrVCqri5mqa32zw |
| Dry-run estimate | 28,968,000 MIST (0.029 SUI) |
| Gas actually spent (publish) | computation 1,000,000 + storage 27,968,000 − rebate 978,120 = **27,989,880 MIST (0.0280 SUI)** |

Modules: `bonded::bonded_vault` (`EnforcerCap`, `Verdict`, `StepUpApproval`, `Vault<phantom T>`,
`mint_verdict`, `mint_stepup_approval`, `new_vault`/`new_and_share_vault`, `fund_vault`, `settle`,
`settle_with_stepup`), `bonded::bonded_registry` (`BondedRegistry`, `Table<address, vector<u8>>`,
`commit_policy` — one-directional, gated by `EnforcerCap`, no rollback function anywhere in the
module).

Events: `VerdictMinted`, `StepUpApprovalMinted`, `Settled` — all `vector<u8>` fields arrive
base64-encoded in `--json`/event JSON (same as the abandoned deployment).

### Setup transactions (after publish)

| Step | Digest | Gas (MIST) |
|---|---|---|
| Create + share `Vault<USDSUI>` | `8XAzLrufePNUdde8Wy4xj5v7qQHSXvoqDRKZ9oBHqDjr` | 2,818,680 |
| Create + share `BondedRegistry` | (same call pattern, `bonded_registry::new_and_share_registry`) | 2,727,480 |
| Split 5 USDSUI (5,000,000 base units) off the large USDSUI coin | — | 2,376,208 |
| `fund_vault` — merge the 5 USDSUI coin into the vault | — | net **+311,304** (storage rebate from the deleted coin exceeded the call's cost) |

### Live smoke test — mint → settle, and the outcome==2 negative path

Per the task's Work item 5: fund the vault with 5 USDSUI, mint a `CLEARED` verdict for a small
`value_usdc`, settle it, confirm the recipient's balance increased by exactly that amount and the
`Verdict` object is gone, then confirm settling a `HELD_FOR_STEPUP` verdict directly through
`settle` (skipping `settle_with_stepup`) fails.

`sui client call` cannot invoke `mint_verdict` alone — it's a non-`entry` `public fun` that returns
an object, and the CLI has no way to auto-transfer that result (`UnusedValueWithoutDrop`). The real
transaction below uses `sui client ptb` to mint the `Verdict` and feed it straight into `settle` in
the same PTB, so it is never a bare, undisposed "result." See `FEEDBACK/sui.md` for the exact
`--make-move-vec`/`--assign` incantation.

| Step | Digest | Result |
|---|---|---|
| Mint `CLEARED` verdict (value 1,000,000) + `settle` into recipient `0x…cafe`, one PTB | `CS9mZRfvCdKptwBFypyYsTC4DP2V2whynXz8PhghLuX6` ([explorer](https://suiscan.xyz/testnet/tx/CS9mZRfvCdKptwBFypyYsTC4DP2V2whynXz8PhghLuX6)) | `VerdictMinted` + `Settled` events emitted; recipient's new `Coin<USDSUI>` object (`0x29fd5fc191efe9b6d5b536c9f72f4d8de4db81da094edb522a61de7891823785`) confirmed via `sui client object` to hold exactly `balance: "1000000"`; vault's `spent_this_period` moved `0` → `1000000` (confirmed via `sui client object` on the vault); the minted `Verdict` id (`0x3974f776a6267d2e9f8e0f9e070d655a1dde3b045b318c339bb253962a2deeff`, from the event) returns `Object ... not found` when queried afterward — it never appears in `effects.created`/`deleted` at all, since it was created and destroyed within the same transaction (see `FEEDBACK/sui.md`) |
| Mint `HELD_FOR_STEPUP` verdict (value 500,000) + attempt `settle` directly, dry-run | — (dry run, no gas spent) | `MoveAbort(.. function_name: Some("settle") .., 0)` = `EHeldForStepupNotSettleableDirectly`, exactly as designed — outcome==2 is not settleable through `settle` |

Gas for the real mint+settle transaction: computation 1,000,000 + storage 5,517,600 − rebate
4,123,152 = **2,394,448 MIST (0.0024 SUI)**.

**Total SUI spent by this Commerce Edition deployment work:** 27,989,880 + 2,818,680 + 2,727,480 +
2,376,208 − 311,304 + 2,394,448 = **37,995,392 MIST (0.0380 SUI)**, against the task's 0.5 SUI cap
and the per-publish 0.3 SUI dry-run gate (the publish dry-run alone was 0.029 SUI, well under it).

Not exercised live on-chain (covered instead by the 12 Move unit tests, two of which are
mutation-tested — see below): `settle_with_stepup`'s success path and its proposal-hash-mismatch
abort; `commit_policy`'s cap gate and forward-only overwrite.

---

## Auto-settlement (sui-settlement package)

2026-09-26. `packages/sui-settlement` (`@bonded/sui-settlement`) submits the real settlement for an
`enforce()` verdict by shelling out to `sui client ptb ... --json` (`execFile` with an argument array,
signed by the CLI keystore; TypeScript never reads key bytes). It reads every result back over gRPC
(`SuiGrpcClient`, `@mysten/sui` 2.33.1). Same package, vault, registry and EnforcerCap as the
Commerce Edition section above. Nothing was republished. Signer / active address:
`0x916c7accd3308e4a8ec896b51b2a0bbcd510abff0579c059455b7e30d147f05a`. Network: testnet only.

### Vault funding: USDSUI mint

The vault held 4 USDSUI (4,000,000 base units), not enough for the $1,250 (`vnd-acme-supplies`) and
$8,450 (`vnd-globex-freight`) demo invoices. The active address owns the correct coin's `TreasuryCap`
(`0x9de96939d2ed17528acbec3abffefcc6e9a14bd79640b54317b49b9ea574316b`,
`TreasuryCap<0x832f9372…54cb::usdsui::USDSUI>`, checked with `sui client object`). The coin's own
`usdsui` module exposes only `init`; there's no mint function, confirmed by querying the package's
functions over GraphQL. Minting therefore went through the framework:
`0x2::coin::mint<T>(&mut TreasuryCap<T>, u64, &mut TxContext): Coin<T>` (signature read from
testnet's `0x2` package over GraphQL, not from memory). The minted coin went straight into
`bonded_vault::fund_vault` in the same PTB, dry-run first. The unrelated `0x8f838f20…::usdsui::USDSUI`
was not touched.

| Step | Digest | Result | Gas (MIST) |
|---|---|---|---|
| `coin::mint<USDSUI>` 20,000 USDSUI (20,000,000,000 base units) + `fund_vault`, one PTB | `3bFBZibHQoW2fyZ2L7PqCsusxMo6HUt2cRBvSfEDK2s4` ([explorer](https://suiscan.xyz/testnet/tx/3bFBZibHQoW2fyZ2L7PqCsusxMo6HUt2cRBvSfEDK2s4)) | Vault balance 4,000,000 → **20,004,000,000**; USDSUI total supply 43,000,000,000 → 63,000,000,000 | 1,000,000 + 4,529,600 − 4,484,304 = **1,045,296** |

### Live runs (`pnpm --filter @bonded/sui-settlement live:testnet`)

| Step | Digest | Result | Gas (MIST) |
|---|---|---|---|
| `commitPolicy(0xaaaa…aa, 0xf372ffa8…0eea)`: the acme demo policy's `canonicalHash` into `BondedRegistry` | `6p3uSWubGhPf84fKYLTcDwcTpEzBmuc2NELoUab1HLE1` ([explorer](https://suiscan.xyz/testnet/tx/6p3uSWubGhPf84fKYLTcDwcTpEzBmuc2NELoUab1HLE1)) | Registry key `0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (the demo agent's 20-byte address, zero-left-padded to a Sui `address`). `readPolicyHash` (gRPC simulate of `has_policy_hash`/`current_policy_hash`) read back `0xf372ffa84e65a92ffddc618578509d9d56ad7d23b7385614d45d36aa6df10eea`. It was `null` before | **2,887,536** |
| `settleCleared`: acme invoice, `mint_verdict` (outcome 0, reason 0, 1,250,000,000) + `settle`, one PTB | `A4xfzgQW6YJatYtQuaNX43xgJ5tzXKVTY5s6f72TxoJL` ([explorer](https://suiscan.xyz/testnet/tx/A4xfzgQW6YJatYtQuaNX43xgJ5tzXKVTY5s6f72TxoJL)) | The verdict came from the real `enforce()`, run with `onchainPolicyHash` read from the registry (not recomputed locally): CLEARED/OK, proposal `0x3333…33`. Recipient = acme's vendor-master payout address `0x4d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e6b7885929facb9c6d3e0`, re-derived via `deriveVendorRecipient`. One `Settled` event (BCS-decoded): vault = ours, recipient = acme, `value_usdc` 1,250,000,000, `spent_this_period` 1,251,000,000, `via_stepup` false. Fullnode `balanceChanges` for the recipient: **+1,250,000,000**. New `Coin<USDSUI>` `0x4e127fb7143d1564157ee54ae66f3c1628435c234bf8bb9447e589c4cb8b4921`, owned by the recipient, balance **1,250,000,000** (read over gRPC and again via `sui client object`). Recipient `getBalance`: 0 → 1,250,000,000 (delta exactly 1,250,000,000). Vault: 20,004,000,000 → 18,754,000,000 | **2,394,448** |

**Total SUI spent by this section:** 1,045,296 + 2,887,536 + 2,394,448 = **6,327,280 MIST (0.0063 SUI)**,
against a 0.3 SUI cap. Sender SUI: 934,975,068 MIST before the mint → 928,647,788 MIST after.

**Not run live: `settleWithStepUp`.** A real `StepUpApproval` requires a real World ID verification,
and the World sandbox credentials (`WORLD_SANDBOX_CLIENT_ID`/`_SECRET`/`WORLD_REDIRECT_URI`) don't
exist yet. Minting one without a real verification would fake the human step. The gating logic is
covered by unit tests only: it refuses hand-built, uncertified, denied, stale, and wrong-proposal
approvals before any config load or CLI call. The live `settle_with_stepup` run waits on World
credentials. The vault holds 18,754 USDSUI, enough for the $8,450 globex invoice when that happens.
