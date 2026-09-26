// Move unit tests for bonded::bonded_registry — the on-chain source of truth
// for enforce()'s stale-policy check (Implementation PRD H.1's
// `BondedRegistry.currentPolicyHash`). Written before relying on the module
// elsewhere, per CLAUDE.md's "write the test first" rule.
#[test_only]
module bonded::bonded_registry_tests;

use sui::test_scenario as ts;
use bonded::bonded_vault::{Self, EnforcerCap};
use bonded::bonded_registry;

const ENFORCER: address = @0xE0F0;
const ATTACKER: address = @0xBAD;
const AGENT: address = @0xA6E7;

#[test]
fun commit_policy_sets_and_then_overwrites_forward() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());
    let mut registry = bonded_registry::new_registry(scenario.ctx());

    assert!(!registry.has_policy_hash(AGENT), 0);

    bonded_registry::commit_policy(&cap, &mut registry, AGENT, b"policy-v1");
    assert!(registry.has_policy_hash(AGENT), 1);
    assert!(registry.current_policy_hash(AGENT) == b"policy-v1", 2);

    // Committing again overwrites forward. There is no rollback function
    // anywhere in bonded_registry — the module exposes exactly one write
    // path (`commit_policy`), which always sets the latest value. The only
    // way back to "policy-v1" is a fresh forward commit of that same value,
    // never an implicit revert.
    bonded_registry::commit_policy(&cap, &mut registry, AGENT, b"policy-v2");
    assert!(registry.current_policy_hash(AGENT) == b"policy-v2", 3);

    transfer::public_transfer(cap, ENFORCER);
    bonded_registry::destroy_registry_for_testing(registry);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 0)] // bonded_registry::EPolicyHashMissing
fun current_policy_hash_aborts_when_never_committed() {
    let mut scenario = ts::begin(ENFORCER);
    let registry = bonded_registry::new_registry(scenario.ctx());

    let _unreachable = registry.current_policy_hash(AGENT);

    // Only reached if the assert above didn't fire, in which case this test
    // should fail because no abort occurred at all — not because of what
    // happens here.
    bonded_registry::destroy_registry_for_testing(registry);
    scenario.end();
}

#[test]
// Same cap-gating discipline as bonded_vault: `commit_policy` requires
// `&EnforcerCap`, and the attacker's inventory never receives one. Without
// this gate, anything could rewrite an agent's policy hash to match a
// malicious proposal's `policy_hash` field and silently defeat
// `enforce()`'s stale-policy check — this is the griefing hole this test
// exists to close. Abort code 3 is `test_scenario::EEmptyInventory`,
// confirmed from source (not a native abort), so this pins the exact
// failure rather than accepting any abort.
#[expected_failure(abort_code = 3)]
fun attacker_without_the_cap_cannot_commit_a_policy() {
    let mut scenario = ts::begin(ENFORCER);
    let cap = bonded_vault::issue_enforcer_cap_for_testing(scenario.ctx());
    transfer::public_transfer(cap, ENFORCER);
    let mut registry = bonded_registry::new_registry(scenario.ctx());

    scenario.next_tx(ATTACKER);
    let stolen: EnforcerCap = scenario.take_from_sender();
    // Unreachable if the property holds.
    bonded_registry::commit_policy(&stolen, &mut registry, AGENT, b"forged-policy");
    transfer::public_transfer(stolen, ATTACKER);
    bonded_registry::destroy_registry_for_testing(registry);
    scenario.end();
}
