# Sui — builder feedback (written as it happens)

Toolchain: `sui 1.73.1-ff1fe0ec4551` on Windows 11 (Git Bash). Network: testnet.

## 2026-09-26 — Pivot; the Phase 1 package below is abandoned

The project moved from the Hostage Protocol (a customs-bond `Bond<T>` object) to the Commerce Edition
(a `Verdict`-object settlement design per `BONDED_COMMERCE_MIGRATION_PRD.md` D.7). The package
recorded below, `0x990acf4456f98cedde25ba5c2b6e32103386bf8391c4ff3d2c32709e35c50d43`, is left as-is on
testnet — Move packages are immutable and harmless to leave — but nothing in this build calls it
anymore. Its ~1.08 SUI + ~1,901 USDSUI holding address (`0x916c…f05a`) carries forward and is reused
for the new deployment. Separately, this repo's git history was deleted (by the user, starting a new
remote) between the old deployment and this pivot, so the notes below describe work that is real and
verifiable on-chain, but is no longer reachable via `git log`.

## 2026-09-25 — Phase 1 bond vault

- **`sui move new` no longer writes an `[addresses]` section, but a hand-written one is still
  accepted silently.** The 1.73 template's `Move.toml` has only `[package]` and an empty
  `[dependencies]` (the framework is implicit). Our PRD asks for `bonded = "0x0"` under
  `[addresses]`; `sui move build` accepts it with no warning either way, so it is unclear from the
  CLI whether the section is used, ignored, or deprecated. A one-line "ignored: named addresses are
  derived from the package name" (or the opposite) would remove the guesswork.

- **`Move.lock` pins the framework to a different commit than the CLI binary, per environment.**
  CLI is `ff1fe0ec`, but the lockfile pins `[pinned.testnet.Sui]` to `rev = 718ae563…` (the
  framework actually on testnet). Correct behaviour, but it means "read the framework source the
  CLI ships" is the wrong instruction: the source that matters is under
  `~/.move/git/…718ae563…/crates/sui-framework/…`. Worth stating in the package-management docs.

- **`Move.lock` records `subdir` with Windows backslashes** (`subdir = 'crates\sui-framework\packages\sui-framework'`).
  A lockfile generated on Windows will differ textually from one generated on macOS/Linux for the
  same dependency, which causes needless churn in a mixed-OS team. Expected forward slashes.

- **`test_scenario` docs say deleting a shared object aborts — it does not.** The doc comment on
  `next_tx` / `end` reads "Will abort if shared or immutable objects were deleted, transferred, or
  wrapped." Our `settle` takes the shared `Bond<T>` by value and calls `object::delete`; the next
  `next_tx` succeeds and the bond id appears in `effects.deleted()`. The feature flag
  `shared_object_deletion` is `true` on testnet (protocol version 137, queried via GraphQL). The
  comment predates shared-object deletion and should drop "deleted".

- **Nice: `expected_failure(abort_code = sui::test_scenario::EObjectNotFound)` works** even though
  the constant is private to the framework module, so a "this object no longer exists" replay test
  can pin the exact abort instead of a bare `expected_failure`. Not documented anywhere we found; we
  discovered code 4 only by pinning a wrong code and reading the failure message.

- **Public fullnode JSON-RPC is gone.** `sui_getProtocolConfig` against
  `https://fullnode.testnet.sui.io:443` returns `-32601 Method not found. JSON-RPC on public
  fullnodes has been deprecated. Please migrate to gRPC or GraphQL endpoints.` `sui client gas`
  from the same CLI still works against the same URL (we did not check which transport it uses). Anything in our TypeScript agents
  that assumed `SuiClient` JSON-RPC against the public fullnode must target GraphQL
  (`https://graphql.testnet.sui.io/graphql`) or gRPC instead. The error message is good — it names
  the fix — but a lot of example code still shows JSON-RPC.

- **CLI 1.73.1 warns its protocol version (126) is behind testnet (137)** on every `sui client`
  command, with "If publishing/upgrading returns a dependency verification error, then install the
  latest CLI version." Publishing worked anyway. The warning appears on stderr for *every* call,
  including read-only ones, so it drowns out real errors in scripted use; a once-per-session
  warning would be friendlier.

- **`publish --dry-run` shows a placeholder gas coin `0xffff…ffff`** in Mutated Objects / Gas
  Object rather than our real gas coin. Harmless, but confusing the first time — it looks like
  the dry run touched an object we do not own. The estimate (29,648,800 MIST incl. buffer) was
  accurate: the real publish cost 27,670,680 MIST net.

- **`sui client object <packageId>` prints the module bytecode one byte per table row** — thousands
  of lines of `│ 161 │` for a single small module. To "confirm the package is live" you only need
  the header (`objType package`, `owner Immutable`, `prevTx`). A `--summary`-style flag, or not
  expanding `module_map` by default, would help.

- **`vector<u8>` event fields come back base64-encoded in `--json` output** (`tx_ref:
  "AQIDBAUG…"`), while `u64` fields come back as decimal strings. Reasonable, but it is not stated
  next to the event output, and our TypeScript side stores these as `0x`-hex `Hash32` — the
  decoder has to base64→hex explicitly or comparisons silently fail.

- **Dry-running a transaction that should abort is a free on-chain guard check.** `refund` before
  the deadline, dry-run against the live shared Bond, returned `MoveAbort(... function_name:
  Some("refund") }, 12)` — our `EDeadlineNotReached` — with no gas spent. Plain `u64` error
  constants (rather than `#[error]` clever errors) keep that code numerically matchable from TS.

- **`u8` event fields are serialized as floats in `sui client ... --json`.** Our `BondRefunded`
  event came back as `"outcome": 3.0, "reason": 0.0`, while `u64` fields are strings (`"price":
  "1000"`). JavaScript's `JSON.parse` hides this (`3.0 === 3`), but a strict decoder (serde into a
  `u8`, Python's `json` which yields `float`, a raw-text compare) will trip. Three different numeric encodings (float for u8, string for u64, base64
  for vector<u8>) in one event is the most surprising thing we hit today.

- **Shared-object deletion confirmed on the live network**, not just in `test_scenario`: `refund`
  took our shared `Bond<SUI>` by value, `object::delete`d its UID, and the effects list it under
  `deleted` (tx `GFgw7ikuFb6Xv4M2ihTqxvdQDsR2LTXko9bwqiYbUf34`). The storage rebate from deleting
  the bond exceeded the refund's own gas cost (net +831,144 MIST to the caller) — a nice incentive
  for "anyone can call refund" keepers that we did not expect.

## 2026-09-25 — Phase 3 slash (upgrade + signed delivery receipts)

- **`sui keytool sign` cannot sign arbitrary bytes.** It BCS-decodes `--data` as
  `TransactionData` and signs `blake2b256(intent || bcs(TransactionData))`; raw bytes fail with
  the opaque `invalid value: integer 98, expected variant index 0 <= i < 1` (98 = `'b'`, read as
  the `TransactionData` enum tag). `--intent 030000` (PersonalMessage scope) is accepted, but the
  payload still has to be a `TransactionData`. There is no CLI command that signs a personal
  message with a file-keystore key, so an agent that must keep its key inside the CLI keystore
  cannot produce a `signPersonalMessage`-compatible signature at all. We worked around it by
  wrapping our 90-byte receipt in a fixed, inert `TransactionData` (one `Pure` input, zero
  commands, no gas coins, budget 0), signing it with `--intent 030000`, and rebuilding the same
  bytes inside Move before `ed25519_verify`. A `sui keytool sign-personal-message` (or `--raw`)
  would remove that whole layer.
- **`--intent` format is undocumented.** `--help` shows only `--intent <INTENT>`. `030000` and
  `0x030000` parse; `3,0,0` and `personal_message` give `Invalid Intent` with no hint of the
  expected syntax.
- **Nice: `sui keytool decode-or-verify-tx` is a precise BCS oracle.** It decoded our hand-built
  envelope into `ProgrammableTransaction { inputs: [Pure(..)], commands: [] }`, `gas_data`,
  `expiration: None`, which confirmed the byte layout without us having to trust our own
  encoder. And `keytool sign --json` prints the exact `digest` it signed, so our Move unit test
  asserts the on-chain reconstruction equals the CLI's digest byte-for-byte.
- **`sui client upgrade` panics when the CLI is behind the network's protocol version, where
  `publish` did not.** With sui 1.73.1 (max protocol 126) against testnet (137), `publish` worked
  in Phase 1, but `upgrade --dry-run` aborts during the local compatibility check with `thread
  'main' panicked at crates\sui-protocol-config\src\lib.rs:2892:9: Network protocol version is
  ProtocolVersion(137), but the maximum supported version by the binary is 126`. The warning
  printed on every command says "If publishing/upgrading returns a *dependency verification
  error*, then install the latest CLI" — but what you actually get is a panic with a backtrace
  hint, not a verification error, and it only hits `upgrade`. 1.73.1 is the newest binary we
  have installed, so the upgrade (and with it the live slash) is blocked on a CLI update.

## 2026-09-26 — Commerce Edition `bonded_vault` + `bonded_registry` (PRD D.7)

- **`sui client call` silently cannot invoke a non-`entry` `public fun` that returns an object —
  the CLI does not auto-transfer the result.** `mint_verdict` returns a bare `Verdict` (by design,
  so `settle` can consume it in the same PTB); calling it alone via `sui client call` failed with
  `Error executing transaction '...': UnusedValueWithoutDrop { result_idx: 0, secondary_idx: 0 }`.
  The fix is `sui client ptb` with `--assign` to bind the `Verdict` to a name and feed it straight
  into `settle` as an argument in the same PTB, never letting it become a top-level "result" that
  needs disposing. Obvious in hindsight, undocumented anywhere near `client call --help`.
- **`sui client ptb` rejects inline bracket literals (`[1,2,3]`) as a `vector<u8>` argument to
  `--move-call`** — `Unexpected '['`, even quoted. The working pattern is
  `--make-move-vec "<u8>" "[34,86,..]" --assign proposal_hash` first, then pass the bound name
  (`proposal_hash`, no `@`, no quotes) as the `--move-call` argument. A bare `0xdeadbeef`-style hex
  literal *is* accepted for a `vector<u8>` position in some contexts but produced a confusing
  `Expected an integer type but got vector<u8> for '3735928559'` error when mixed with other
  positional args in our case — `--make-move-vec` was the reliable path and is what we used for
  the real mint+settle transaction below.
- **An object created and destroyed within the same transaction never appears anywhere in
  `effects.created`/`effects.deleted` or `objectChanges` — not even as a net-zero pair.** Minting a
  `Verdict` and consuming it via `settle` in one PTB left the `VerdictMinted` event as the only
  on-chain trace of the object ever existing; `sui client object <verdict_id>` immediately after
  returned `Object ... not found`, with no intermediate "created then deleted" line in the JSON
  effects at all. This is arguably the cleanest possible confirmation of the design's central claim
  ("no boolean flag to forget, because there is nothing left to check") — but if you're expecting
  to *see* the deletion recorded anywhere queryable, per-transaction, you won't; only the emitted
  event and the object's absence prove it happened.
- **This project's testnet address holds two unrelated coins both named `usdsui::USDSUI`, from two
  different packages.** `docs/VERIFY_FINDINGS.md` item 6 confirms
  `0x832f9372…54cb::usdsui::USDSUI` (43,000 supply, `TreasuryCap` at `0x9de969…316b`) as the one
  this project's address is the `TreasuryCap` holder for — but `sui client balance --json` also
  shows a *second*, same-named `0x8f838f20…f239::usdsui::USDSUI` (1,000 supply, a different
  `TreasuryCap`) sitting in the same wallet, presumably a leftover from an unrelated experiment on
  this address. Matching on `symbol`/`name` alone would have picked the wrong coin type for the
  vault's `T`; the package address is the only reliable discriminator. Recorded here so nobody
  re-derives this the hard way.
- **`Table`'s (and any private-field struct's) fields are genuinely inaccessible from a different
  module, even a same-package `#[test_only]` test module** — Move's field-privacy is per-module,
  not per-package. `BondedRegistry { id, current_policy_hash }` and `Vault<T> { id, balance,
  spent_this_period }` cannot be pattern-matched from `bonded_registry_tests`/`bonded_vault_tests`
  at all; the defining module has to expose a `#[test_only]` teardown helper
  (`destroy_vault_for_testing`, `destroy_registry_for_testing`) that does the destructuring
  internally. `vector<u8>` has `drop` (since `u8: drop`), so `table::drop` works directly on a
  non-empty `Table<address, vector<u8>>` without walking every key first — worth knowing before
  reaching for a manual `while`-loop drain.
- **Nice, confirmed from the framework's own tests, not guessed:** `#[expected_failure(abort_code =
  N)]` matches purely on the numeric abort code, with no `location` needed, even when the abort
  actually originates in a *different* module than the one under test —
  `sui-framework/tests/table_tests.move` pins `sui::dynamic_field::EFieldAlreadyExists` even though
  the abort happens inside `dynamic_field`, called transitively through `table::add`. We relied on
  this to pin `test_scenario::EEmptyInventory` (= `3`, confirmed from
  `sui-framework/sources/test/test_scenario.move` — it's a private, non-`native` constant reached
  via a plain `assert!`, so the code is knowable) for our own cap-gating tests, while deliberately
  leaving the "can't refetch a deleted object" test as a bare `expected_failure` because that path
  goes through the *native* `take_from_address_by_id`, whose abort code isn't visible in any
  `.move` source we have — CLAUDE.md's rule against guessing a signature applies just as much to a
  native abort code.
- **Live confirmation, testnet, package
  `0xf3d914b39722e1c6c3f0e274d088623c0e050d3125b8f658d48b94498efbf57a`:** minted a `CLEARED`
  `Verdict` for 1,000,000 USDSUI base units and settled it against the shared `Vault<USDSUI>` in one
  PTB (tx `CS9mZRfvCdKptwBFypyYsTC4DP2V2whynXz8PhghLuX6`) — the recipient's new `Coin<USDSUI>`
  object shows `balance: "1000000"` exactly, and the vault's `spent_this_period` moved from `0` to
  `1000000` in the same call. A follow-up dry-run minting a `HELD_FOR_STEPUP` verdict and passing it
  straight to `settle` (skipping `settle_with_stepup`) aborted exactly as designed:
  `MoveAbort(..., function_name: Some("settle") ..., 0)` — abort code `0` is
  `EHeldForStepupNotSettleableDirectly`, and the dry run cost no gas.

## 2026-09-26 — Auto-settlement package (`@bonded/sui-settlement`)

- **`sui client ptb --dry-run --json` ignores `--json`.** A real `ptb ... --json` prints clean JSON
  to stdout, but adding `--dry-run` prints the boxed human table instead. So a scripted
  "dry-run first, then execute" pre-flight has to regex the line `Dry run completed, execution
  status: success` out of free text. Machine-readable dry-run output would remove the only fragile
  parse in our settlement path.
- **A coin's own package may have no mint function, but the TreasuryCap holder can always mint through
  the framework.** Our `usdsui` module exposes only `init`, per GraphQL `asMovePackage { module(name:
  "usdsui") { functions } }`. `0x2::coin::mint<T>(&mut TreasuryCap<T>, u64, &mut TxContext):
  Coin<T>` (also read over GraphQL from testnet's `0x2`) minted 20,000 USDSUI and fed it straight into
  `fund_vault` in one PTB. The GraphQL `function { visibility isEntry parameters { repr } return { repr
  } }` query is a clean, exact way to verify a signature before calling it. It's much better than
  `sui client object <pkg>`, which dumps bytecode one byte per row.
- **Nice: `SuiGrpcClient.simulateTransaction({ include: { commandResults: true } })` is a working
  dev-inspect.** Reading `bonded_registry::current_policy_hash` needed no gas coin and no funded
  sender: the SDK simulates with a mocked gas coin when none is set, as its own type docs say.
  `returnValues[0].bcs` decoded directly with `bcs.byteVector()`. The SDK's type docs also warn
  that event/object `json` shapes differ between JSON-RPC, gRPC and GraphQL, and recommend decoding
  `bcs` instead. We BCS-decode the `Settled` event and the payout `Coin<T>` (`{ id, balance: u64 }`)
  rather than trusting `json` field names. That also sidesteps the float-for-`u8`/string-for-`u64`
  inconsistency noted on 2026-09-25.
- **An `address` argument shorter than 32 bytes is silently zero-left-padded, by the CLI (`@0xaa…aa`,
  20 bytes) and by `normalizeSuiAddress`.** Our demo agent id is a 20-byte EVM-shaped string, so its
  registry key on-chain is `0x000000000000000000000000aaaa…aa`. It's consistent at both ends (commit
  and read both pad), so nothing broke. But nothing warns you that a 20-byte EVM address and its
  zero-padded 32-byte form are the same Sui key. A cross-chain project could be confused by that, or
  could collide two ids that way.
- **Consumer-side, our own bug, recorded because it only surfaced with `@mysten/sui`:** our copied Jest
  `moduleNameMapper` of `'^(\.{1,2}/.*)\.js$'` in a plain JS string collapses `\.` to `.`, so it also
  rewrote the SDK's internal `./type-tag-serializer.mjs` imports and failed with "Could not locate
  module". `@mysten/sui` 2.x ships ESM-only `.mjs` internals, so any monorepo with that
  (common) mapper will hit this the first time it imports the SDK under Jest.
- **Live confirmation:** mint+fund `3bFBZibHQoW2fyZ2L7PqCsusxMo6HUt2cRBvSfEDK2s4`; `commit_policy`
  `6p3uSWubGhPf84fKYLTcDwcTpEzBmuc2NELoUab1HLE1`; acme `mint_verdict`+`settle` for 1,250,000,000
  base units `A4xfzgQW6YJatYtQuaNX43xgJ5tzXKVTY5s6f72TxoJL`. The recipient's new coin holds exactly
  1,250,000,000 and the fullnode's `balanceChanges` agree. Total gas for all three: 6,327,280 MIST.
