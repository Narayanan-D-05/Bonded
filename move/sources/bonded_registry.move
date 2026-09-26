// Commerce Edition — on-chain source of truth for `enforce()`'s stale-policy
// check (Implementation PRD H.1's `BondedRegistry.currentPolicyHash`, restated
// for Sui per this task's design). `Table<address, vector<u8>>` API verified
// against the pinned framework source at rev 718ae563
// (sui-framework/sources/table.move) — add/borrow/borrow_mut/contains/remove
// all confirmed there; nothing here is guessed.
module bonded::bonded_registry;

use sui::table::{Self, Table};
use bonded::bonded_vault::EnforcerCap;

/// `current_policy_hash` was queried for an agent with no committed policy.
const EPolicyHashMissing: u64 = 0;

/// Per-agent current policy hash. One shared registry for the whole package.
/// `commit_policy` is the ONLY write path, and it always overwrites the
/// previous value for that agent — there is no rollback function anywhere in
/// this module. That is deliberate: the registry is a one-directional
/// pointer to "the policy hash `enforce()` should currently treat as valid
/// for this agent," not a history log. If a previous policy hash needs to be
/// restored, the enforcer commits it forward again as a new write; nothing
/// in this module lets a caller jump back to a prior value implicitly.
public struct BondedRegistry has key {
    id: UID,
    current_policy_hash: Table<address, vector<u8>>,
}

/// Anyone may create and share the registry once; there is exactly one in
/// practice (created at deploy time), gating is on `commit_policy`, not on
/// the registry's existence.
public fun new_registry(ctx: &mut TxContext): BondedRegistry {
    BondedRegistry { id: object::new(ctx), current_policy_hash: table::new(ctx) }
}

public fun new_and_share_registry(ctx: &mut TxContext) {
    transfer::share_object(new_registry(ctx));
}

/// The one-directional write path. Requires the EnforcerCap: without this
/// gate, anything could overwrite an agent's policy hash to match a
/// malicious proposal's `policy_hash` field, which would silently defeat
/// `enforce()`'s entire stale-policy check. Overwrites forward; there is no
/// paired "undo" function in this module.
public fun commit_policy(
    _cap: &EnforcerCap,
    registry: &mut BondedRegistry,
    agent: address,
    policy_hash: vector<u8>,
) {
    if (registry.current_policy_hash.contains(agent)) {
        *registry.current_policy_hash.borrow_mut(agent) = policy_hash;
    } else {
        registry.current_policy_hash.add(agent, policy_hash);
    };
}

public fun has_policy_hash(registry: &BondedRegistry, agent: address): bool {
    registry.current_policy_hash.contains(agent)
}

/// Aborts with `EPolicyHashMissing` if `commit_policy` was never called for
/// this agent.
public fun current_policy_hash(registry: &BondedRegistry, agent: address): vector<u8> {
    assert!(registry.current_policy_hash.contains(agent), EPolicyHashMissing);
    *registry.current_policy_hash.borrow(agent)
}

/// `BondedRegistry`'s fields are private outside this module, so tests need
/// a module-provided teardown. `vector<u8>` has `drop`, so the table can be
/// dropped directly (non-empty or not) without walking every key first.
#[test_only]
public fun destroy_registry_for_testing(registry: BondedRegistry) {
    let BondedRegistry { id, current_policy_hash } = registry;
    object::delete(id);
    table::drop(current_policy_hash);
}
