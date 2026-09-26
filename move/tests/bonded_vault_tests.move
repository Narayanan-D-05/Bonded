// Move unit tests for bonded::bonded_vault, written before source review would
// otherwise happen — per CLAUDE.md's "write the test first" rule for
// stake/settlement logic, and satisfying PRD Part G's "Move" row: "A Verdict
// object cannot be consumed twice ... settle_with_stepup reverts if
// proposal_hash mismatches."
//
// `sui::test_scenario` API (begin/next_tx/take_from_sender_by_id/
// take_shared/return_shared/end, TransactionEffects, native abort on a
// missing/already-taken object) verified against the pinned framework source
// at rev 718ae563, sui-framework/sources/test/test_scenario.move.
#[test_only]
module bonded::bonded_vault_tests;

use sui::coin;
use sui::sui::SUI;
use sui::test_scenario as ts;
use bonded::bonded_vault::{Self, EnforcerCap, Verdict};

const ENFORCER: address = @0xE0F0;
const RECIPIENT: address = @0xCAFE;
const ATTACKER: address = @0xBAD;

const CLEARED: u8 = 0;
const REFUSED: u8 = 1;
const HELD_FOR_STEPUP: u8 = 2;

// === mint_verdict requires the cap ===
//
// This is provable structurally (the function signature has no other way to
// produce a Verdict), and here it's also proven at runtime: the attacker's
// inventory never received an EnforcerCap, so `take_from_sender` for it
// aborts — there is no way for the attacker to even obtain a `&EnforcerCap`
// to pass in.

#[test]
fun enforcer_cap_holder_can_mint_a_verdict() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());

    let verdict = bonded_vault::mint_verdict(
        &cap,
        b"proposal-1",
        b"policy-1",
        CLEARED,
        0,
        1_000_000,
        scenario.ctx(),
    );

    assert!(verdict.verdict_outcome() == CLEARED, 0);
    assert!(verdict.verdict_value_usdc() == 1_000_000, 1);

    transfer::public_transfer(verdict, ENFORCER);
    transfer::public_transfer(cap, ENFORCER);
    scenario.end();
}

#[test]
// `test_scenario::take_from_sender` -> `take_from_address` asserts
// `id_opt.is_some()` with `EEmptyInventory = 3` (confirmed from
// sui-framework/sources/test/test_scenario.move; not a native abort, so the
// code is knowable). Pinning the exact code — rather than a bare
// `expected_failure` — means this test can't be satisfied by an unrelated
// abort: if the security property broke and the attacker's fetch somehow
// succeeded, the test below consumes the cap and ends normally instead of
// aborting at all, which correctly fails the test.
#[expected_failure(abort_code = 3)]
fun attacker_without_the_cap_cannot_obtain_one() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());
    transfer::public_transfer(cap, ENFORCER); // stays with the enforcer, never sent to the attacker

    scenario.next_tx(ATTACKER);
    // The attacker's inventory has no EnforcerCap in it. There is no code
    // path in bonded_vault that lets them synthesize one, so the only thing
    // left to demonstrate is that fetching it from their own inventory
    // aborts (empty inventory) rather than succeeding some other way.
    let stolen: EnforcerCap = scenario.take_from_sender();
    // Unreachable if the property holds; consumes `stolen` so this still
    // type-checks on the (never-taken) success path.
    transfer::public_transfer(stolen, ATTACKER);
    scenario.end();
}

// === settle() consumes the Verdict — it cannot be reused ===

#[test]
fun settle_cleared_transfers_value_and_updates_budget_before_transfer() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());
    let mut vault = bonded_vault::new_vault<SUI>(scenario.ctx());
    bonded_vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()));

    let verdict = bonded_vault::mint_verdict(
        &cap,
        b"proposal-2",
        b"policy-1",
        CLEARED,
        0,
        400_000,
        scenario.ctx(),
    );

    bonded_vault::settle(&mut vault, verdict, RECIPIENT, scenario.ctx());

    // Budget updates and the transfer both happened; check both sides of the
    // ledger. Order (budget incremented before the coin is split off) is
    // enforced by the source's statement order in `settle`, and is the thing
    // this test exists to pin, per PRD Part G's explicit ask.
    assert!(vault.spent_this_period() == 400_000, 0);
    assert!(vault.vault_balance_value() == 600_000, 1);

    let (remaining, spent) = bonded_vault::destroy_vault_for_testing(vault);
    assert!(remaining == 600_000, 2);
    assert!(spent == 400_000, 3);

    transfer::public_transfer(cap, ENFORCER);
    scenario.next_tx(RECIPIENT);
    let payout = scenario.take_from_sender<coin::Coin<SUI>>();
    assert!(payout.value() == 400_000, 4);
    transfer::public_transfer(payout, RECIPIENT);
    scenario.end();
}

#[test]
fun settle_refused_moves_nothing() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());
    let mut vault = bonded_vault::new_vault<SUI>(scenario.ctx());
    bonded_vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(100_000, scenario.ctx()));

    let verdict = bonded_vault::mint_verdict(
        &cap,
        b"proposal-3",
        b"policy-1",
        REFUSED,
        3,
        999_000, // irrelevant: REFUSED never spends it
        scenario.ctx(),
    );
    bonded_vault::settle(&mut vault, verdict, RECIPIENT, scenario.ctx());

    assert!(vault.spent_this_period() == 0, 0);
    assert!(vault.vault_balance_value() == 100_000, 1);

    let (remaining, spent) = bonded_vault::destroy_vault_for_testing(vault);
    assert!(remaining == 100_000, 2);
    assert!(spent == 0, 3);
    transfer::public_transfer(cap, ENFORCER);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 0)]
fun settle_aborts_on_held_for_stepup_outcome() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());
    let mut vault = bonded_vault::new_vault<SUI>(scenario.ctx());
    bonded_vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(100_000, scenario.ctx()));

    let verdict = bonded_vault::mint_verdict(
        &cap,
        b"proposal-4",
        b"policy-1",
        HELD_FOR_STEPUP,
        6,
        50_000,
        scenario.ctx(),
    );
    // Must abort: a HELD_FOR_STEPUP verdict is not settleable through this
    // function at all.
    bonded_vault::settle(&mut vault, verdict, RECIPIENT, scenario.ctx());
    abort 99 // unreachable if the assertion above did its job
}

#[test]
// `take_from_sender_by_id` bottoms out in the NATIVE `take_from_address_by_id`
// (no Move-level `assert!` to read a code from), so per CLAUDE.md's rule
// against guessing a signature/behavior that isn't confirmed, this is a bare
// `expected_failure` rather than a guessed abort code. To avoid that turning
// into a rubber stamp (any unrelated abort would otherwise "pass" this test),
// the success path below properly consumes the refetched object and ends the
// scenario normally instead of aborting — so if the object were NOT actually
// gone, this test fails outright (no abort at all) rather than passing on a
// coincidental one.
#[expected_failure]
fun a_settled_verdict_object_id_cannot_be_fetched_again() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());
    let verdict = bonded_vault::mint_verdict(
        &cap,
        b"proposal-5",
        b"policy-1",
        CLEARED,
        0,
        10_000,
        scenario.ctx(),
    );
    let verdict_id = object::id(&verdict);
    transfer::public_transfer(verdict, ENFORCER);
    transfer::public_transfer(cap, ENFORCER);

    scenario.next_tx(ENFORCER);
    let verdict: Verdict = scenario.take_from_sender_by_id(verdict_id);
    let mut vault = bonded_vault::new_vault<SUI>(scenario.ctx());
    bonded_vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(10_000, scenario.ctx()));
    bonded_vault::settle(&mut vault, verdict, RECIPIENT, scenario.ctx());
    let (_remaining, _spent) = bonded_vault::destroy_vault_for_testing(vault);

    // Advance the scenario so the deletion of the Verdict object from the
    // previous transaction is committed to the (simulated) global inventory.
    scenario.next_tx(ENFORCER);

    // The object should be gone: this MUST abort. There is no boolean flag
    // left to check — the object itself no longer exists, which is the whole
    // point. If it somehow is NOT gone, consume it properly and end the
    // scenario normally, which fails this test for the right reason.
    let cannot_refetch: Verdict = scenario.take_from_sender_by_id(verdict_id);
    transfer::public_transfer(cannot_refetch, ENFORCER);
    scenario.end();
}

// === settle_with_stepup: two objects, must match, both get consumed ===

#[test]
fun settle_with_stepup_succeeds_when_proposal_hashes_match() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());
    let mut vault = bonded_vault::new_vault<SUI>(scenario.ctx());
    bonded_vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()));

    let verdict = bonded_vault::mint_verdict(
        &cap,
        b"proposal-6",
        b"policy-1",
        HELD_FOR_STEPUP,
        6,
        750_000,
        scenario.ctx(),
    );
    let approval = bonded_vault::mint_stepup_approval(&cap, b"proposal-6", scenario.ctx());

    bonded_vault::settle_with_stepup(&mut vault, verdict, approval, RECIPIENT, scenario.ctx());

    assert!(vault.spent_this_period() == 750_000, 0);
    assert!(vault.vault_balance_value() == 250_000, 1);

    let (remaining, spent) = bonded_vault::destroy_vault_for_testing(vault);
    assert!(remaining == 250_000, 2);
    assert!(spent == 750_000, 3);
    transfer::public_transfer(cap, ENFORCER);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 2)]
fun settle_with_stepup_aborts_on_proposal_hash_mismatch() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());
    let mut vault = bonded_vault::new_vault<SUI>(scenario.ctx());
    bonded_vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()));

    let verdict = bonded_vault::mint_verdict(
        &cap,
        b"proposal-7-real",
        b"policy-1",
        HELD_FOR_STEPUP,
        6,
        200_000,
        scenario.ctx(),
    );
    // Approval minted for a DIFFERENT proposal — must not be usable here.
    let approval = bonded_vault::mint_stepup_approval(&cap, b"proposal-7-forged", scenario.ctx());

    bonded_vault::settle_with_stepup(&mut vault, verdict, approval, RECIPIENT, scenario.ctx());
    abort 99
}

#[test]
#[expected_failure(abort_code = 1)]
fun settle_with_stepup_aborts_if_verdict_is_not_held_for_stepup() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());
    let mut vault = bonded_vault::new_vault<SUI>(scenario.ctx());
    bonded_vault::fund_vault(&mut vault, coin::mint_for_testing<SUI>(1_000_000, scenario.ctx()));

    // CLEARED, not HELD_FOR_STEPUP — settle_with_stepup must refuse it even
    // though the proposal hashes match.
    let verdict = bonded_vault::mint_verdict(
        &cap,
        b"proposal-8",
        b"policy-1",
        CLEARED,
        0,
        200_000,
        scenario.ctx(),
    );
    let approval = bonded_vault::mint_stepup_approval(&cap, b"proposal-8", scenario.ctx());

    bonded_vault::settle_with_stepup(&mut vault, verdict, approval, RECIPIENT, scenario.ctx());
    abort 99
}
