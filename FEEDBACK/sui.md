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
