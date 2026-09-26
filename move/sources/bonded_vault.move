// Copyright: this project's authors.
//
// Commerce Edition settlement layer — PRD Part D.7 / H.3 ("Sui — DeFi & Payments").
// Verified against the pinned Sui framework source at rev 718ae563 (Move.lock),
// checked out locally at
// ~/.move/git/https___github_com_MystenLabs_sui_git_718ae563.../crates/sui-framework/
// packages/sui-framework/sources/{object,transfer,coin,balance,event}.move, and cross-
// checked against the CLI's own toolchain checkout (rev ff1fe0ec4551) example packages
// under examples/move/{basics,coin,random/raffles} for the Move 2024 edition import
// conventions (object::new/UID/TxContext/transfer are auto-aliased; coin, balance,
// event, table are not and need explicit `use`). No API here is guessed.
module bonded::bonded_vault;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;

/// Verdict outcomes. These numbers are a wire format: they MUST match
/// @bonded/seam's `ReasonCode`/outcome numbering exactly (see the task's fixed
/// values: 0 CLEARED, 1 REFUSED, 2 HELD_FOR_STEPUP — packages/seam/src/types.ts
/// does not yet carry the Commerce-edition enforcer's outcome enum, so these
/// are pinned here directly per instruction rather than imported).
const CLEARED: u8 = 0;
#[allow(unused_const)] // documents the wire format; REFUSED is the implicit else of `settle`
const REFUSED: u8 = 1;
const HELD_FOR_STEPUP: u8 = 2;

/// A HELD_FOR_STEPUP verdict was passed to `settle`, which only understands
/// CLEARED and REFUSED. It must go through `settle_with_stepup` instead.
const EHeldForStepupNotSettleableDirectly: u64 = 0;
/// `settle_with_stepup` was called with a verdict whose outcome is not
/// HELD_FOR_STEPUP.
const ENotHeldForStepup: u64 = 1;
/// The Verdict and the StepUpApproval were minted for different proposals —
/// the two objects passed to `settle_with_stepup` don't belong together.
const EProposalHashMismatch: u64 = 2;

/// Held by the enforcer's address, minted once at `init`. Presenting this
/// capability is what lets `mint_verdict`/`mint_stepup_approval` produce a
/// real, spendable object — there is no address check anywhere in this
/// module, only "you must hold this object to call this function." This is
/// the structural answer to "what stops the enforcer itself from being
/// compromised": in Move there is no signature to leak, only an object to
/// steal, which is a narrower, more visible threat than a leaked private key.
public struct EnforcerCap has key, store { id: UID }

/// A verdict is an OBJECT, not a mapping entry. `settle`/`settle_with_stepup`
/// CONSUME it — after use it no longer exists on-chain. That is the entire
/// replay guard: there is no boolean flag to forget to check, because there
/// is nothing left to check against once the object is gone.
public struct Verdict has key, store {
    id: UID,
    proposal_hash: vector<u8>,
    policy_hash: vector<u8>,
    outcome: u8, // 0 CLEARED, 1 REFUSED, 2 HELD_FOR_STEPUP
    reason_code: u16,
    value_usdc: u64,
}

/// Minted only by the EnforcerCap holder (same gate as `mint_verdict` — a
/// documented choice: this build does not introduce a second, distinct
/// capability type for the step-up path, because in this codebase the
/// enforcer is the only component that ever consumes a real World
/// fresh-verification result and turns it into an on-chain object; splitting
/// that into a second cap would add a capability to steal without adding a
/// real security boundary. See FEEDBACK/sui.md for this reasoning, dated).
/// Presence of this object on-chain IS the proof a human freshly verified,
/// for this specific proposal — not a flag a compromised backend could set.
public struct StepUpApproval has key, store {
    id: UID,
    proposal_hash: vector<u8>,
}

/// A capital allocator gated by object capabilities, generic over the
/// settlement coin type `T`. On Sui testnet this is instantiated with
/// USDSUI (`0x832f9372...::usdsui::USDSUI`, 6 decimals) — see
/// docs/VERIFY_FINDINGS.md item 6 and docs/THREATMODEL.md for why: it's the
/// coin type this project's testnet address already holds and is the
/// TreasuryCap holder for, and there is no faucet USDC on Sui testnet that
/// this project controls.
public struct Vault<phantom T> has key {
    id: UID,
    balance: Balance<T>,
    spent_this_period: u64,
}

public struct VerdictMinted has copy, drop {
    verdict_id: ID,
    proposal_hash: vector<u8>,
    policy_hash: vector<u8>,
    outcome: u8,
    reason_code: u16,
    value_usdc: u64,
}

public struct StepUpApprovalMinted has copy, drop {
    approval_id: ID,
    proposal_hash: vector<u8>,
}

public struct Settled has copy, drop {
    vault_id: ID,
    recipient: address,
    value_usdc: u64,
    spent_this_period: u64,
    via_stepup: bool,
}

/// Mints exactly one EnforcerCap to the publisher. There is no other way to
/// obtain one: it is not re-mintable, and it is not address-checked anywhere
/// downstream — whoever holds this object IS the enforcer, structurally.
fun init(ctx: &mut TxContext) {
    transfer::transfer(EnforcerCap { id: object::new(ctx) }, ctx.sender());
}

/// A pure constructor requiring the cap as an argument. Provable structurally,
/// not just by convention: there is no call site anywhere in this package or
/// any importer that can produce a `Verdict` without an `&EnforcerCap` in
/// scope, because the parameter is not optional and there is no other
/// function that returns a `Verdict`.
public fun mint_verdict(
    _cap: &EnforcerCap,
    proposal_hash: vector<u8>,
    policy_hash: vector<u8>,
    outcome: u8,
    reason_code: u16,
    value_usdc: u64,
    ctx: &mut TxContext,
): Verdict {
    let verdict = Verdict {
        id: object::new(ctx),
        proposal_hash,
        policy_hash,
        outcome,
        reason_code,
        value_usdc,
    };
    event::emit(VerdictMinted {
        verdict_id: object::uid_to_inner(&verdict.id),
        proposal_hash: verdict.proposal_hash,
        policy_hash: verdict.policy_hash,
        outcome: verdict.outcome,
        reason_code: verdict.reason_code,
        value_usdc: verdict.value_usdc,
    });
    verdict
}

/// Gated identically to `mint_verdict` — see the doc comment on
/// `StepUpApproval` for why this reuses `EnforcerCap` rather than a distinct
/// capability type.
public fun mint_stepup_approval(
    _cap: &EnforcerCap,
    proposal_hash: vector<u8>,
    ctx: &mut TxContext,
): StepUpApproval {
    let approval = StepUpApproval { id: object::new(ctx), proposal_hash };
    event::emit(StepUpApprovalMinted {
        approval_id: object::uid_to_inner(&approval.id),
        proposal_hash: approval.proposal_hash,
    });
    approval
}

/// Anyone may create a vault for coin type `T` — vault *creation* is not
/// capability-gated, only funding-with-intent-to-settle and settlement
/// itself matter for safety, and creating an empty vault cannot be used to
/// steal anything.
public fun new_vault<T>(ctx: &mut TxContext): Vault<T> {
    Vault { id: object::new(ctx), balance: balance::zero<T>(), spent_this_period: 0 }
}

/// Convenience entry point for the CLI/demo: create a vault for `T` and share
/// it in the same transaction.
public fun new_and_share_vault<T>(ctx: &mut TxContext) {
    transfer::share_object(new_vault<T>(ctx));
}

/// Tops up the vault so the demo can fund it. No cap required: merging a
/// `Coin<T>` the caller already owns into the vault's balance cannot be used
/// to take anything that wasn't already being given away.
public fun fund_vault<T>(vault: &mut Vault<T>, payment: Coin<T>) {
    coin::put(&mut vault.balance, payment);
}

public fun spent_this_period<T>(vault: &Vault<T>): u64 {
    vault.spent_this_period
}

public fun vault_balance_value<T>(vault: &Vault<T>): u64 {
    balance::value(&vault.balance)
}

public fun vault_id<T>(vault: &Vault<T>): ID {
    object::uid_to_inner(&vault.id)
}

public fun verdict_outcome(verdict: &Verdict): u8 {
    verdict.outcome
}

public fun verdict_value_usdc(verdict: &Verdict): u64 {
    verdict.value_usdc
}

/// Consumes the Verdict — after this call it is gone, whatever the outcome,
/// so it can never be replayed. If CLEARED, `spent_this_period` is
/// incremented BEFORE the coin is split and transferred (order matters for
/// the audit trail, even though Move's linear-ownership model already
/// prevents the reentrancy this ordering would guard against in Solidity —
/// tested anyway, per PRD Part G's explicit ask). If REFUSED, nothing moves;
/// the verdict is already destroyed above and there was never anything to do.
/// HELD_FOR_STEPUP is refused structurally: it must go through
/// `settle_with_stepup`, never this function.
public fun settle<T>(vault: &mut Vault<T>, verdict: Verdict, recipient: address, ctx: &mut TxContext) {
    let Verdict { id, proposal_hash: _, policy_hash: _, outcome, reason_code: _, value_usdc } = verdict;
    object::delete(id);
    assert!(outcome != HELD_FOR_STEPUP, EHeldForStepupNotSettleableDirectly);

    if (outcome == CLEARED) {
        vault.spent_this_period = vault.spent_this_period + value_usdc;
        let payout = coin::take(&mut vault.balance, value_usdc, ctx);
        let vault_id = object::uid_to_inner(&vault.id);
        transfer::public_transfer(payout, recipient);
        event::emit(Settled {
            vault_id,
            recipient,
            value_usdc,
            spent_this_period: vault.spent_this_period,
            via_stepup: false,
        });
    };
    // outcome == REFUSED: nothing moves, verdict is already gone above.
}

/// The step-up path. Requires BOTH a HELD_FOR_STEPUP verdict AND a
/// StepUpApproval minted for the SAME proposal — two objects consumed,
/// never one signature-shaped flag, matching the original Ledger version's
/// "two signatures, never one" discipline.
public fun settle_with_stepup<T>(
    vault: &mut Vault<T>,
    verdict: Verdict,
    approval: StepUpApproval,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert!(verdict.outcome == HELD_FOR_STEPUP, ENotHeldForStepup);
    assert!(verdict.proposal_hash == approval.proposal_hash, EProposalHashMismatch);

    let Verdict { id, proposal_hash: _, policy_hash: _, outcome: _, reason_code: _, value_usdc } = verdict;
    object::delete(id);
    let StepUpApproval { id: approval_id, proposal_hash: _ } = approval;
    object::delete(approval_id);

    vault.spent_this_period = vault.spent_this_period + value_usdc;
    let payout = coin::take(&mut vault.balance, value_usdc, ctx);
    let vault_id = object::uid_to_inner(&vault.id);
    transfer::public_transfer(payout, recipient);
    event::emit(Settled {
        vault_id,
        recipient,
        value_usdc,
        spent_this_period: vault.spent_this_period,
        via_stepup: true,
    });
}

#[test_only]
public fun issue_enforcer_cap_for_testing(ctx: &mut TxContext): EnforcerCap {
    EnforcerCap { id: object::new(ctx) }
}

/// Vault has `key` only (no `store`), and its fields are private outside
/// this module, so tests need a module-provided way to tear one down after
/// asserting on it. Returns (remaining balance value, spent_this_period) so
/// the caller can assert on both.
#[test_only]
public fun destroy_vault_for_testing<T>(vault: Vault<T>): (u64, u64) {
    let Vault { id, balance, spent_this_period } = vault;
    object::delete(id);
    let remaining = balance::destroy_for_testing(balance);
    (remaining, spent_this_period)
}
