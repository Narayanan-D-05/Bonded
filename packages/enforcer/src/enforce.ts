/**
 * The `enforce()` decision loop — Implementation PRD Part D.2, confirmed
 * unchanged by the Commerce Edition migration (Migration PRD Part D.3): the
 * five-step loop (stale-policy check, forbidden-action check, pinned-
 * checkpoint premise resolution, budget check, irreversible-threshold hold)
 * does not need a single line changed to move domains — only
 * `resolvePremise`'s dispatch table (owned by a different package) grows
 * new cases.
 *
 * DEVIATION FROM D.2, DELIBERATE, NOT A GUESS AT A SUI API:
 * D.2's original pseudocode calls a package-local `getCurrentBlock()` and
 * feeds its `bigint` result straight into `resolvePremise(def, blockChecked)`.
 * That assumed an EVM/Arc-shaped "current block number". Sui does not expose
 * chain state the same way (checkpoints, not blocks), and per the migration
 * task this package must not depend on any chain SDK to find out what a
 * checkpoint even is. So `getCurrentBlock()` becomes `deps.getCheckpoint()`
 * and `resolvePremise` becomes `deps.resolvePremise` — both dependency-
 * injected by the caller, which is free to be a Sui checkpoint reader, an
 * Arc block reader, or a synchronous test fixture. This file imports
 * nothing but `@bonded/seam`'s types and its own two sibling modules.
 *
 * `getCheckpoint()` is typed `Promise<bigint>`, not `Promise<unknown>`, even
 * though nothing in this file's own logic depends on what a "checkpoint"
 * means to the caller. `Verdict.blockChecked` (Implementation PRD C.1,
 * unchanged) is itself typed `bigint`, and that value has to come from
 * somewhere without an unsafe cast. `bigint` is the most chain-neutral
 * representation of "a monotonic version/sequence number" available, and it
 * is threaded through unchanged as `resolvePremise`'s `at` argument — an
 * adapter that doesn't care about pinning (Intercepta, the issuer-oracle)
 * simply ignores it.
 *
 * `logRef` (also part of the unchanged `Verdict` shape) has no defined
 * derivation anywhere in D.2 — its pseudocode calls undefined `refuse()`/
 * `hold()`/`clear()` helpers without showing their bodies. Rather than
 * fabricate a hash locally (this package carries no hashing/crypto
 * dependency, by the same zero-extra-deps design as `canonicalHash` below),
 * that derivation is dependency-injected too, as `deps.computeLogRef`.
 * Every other field of every `Verdict` this file returns is exactly what
 * D.2 specifies.
 */

import type { Address, Hash32, Premise, PolicyArtifact, Proposal, Verdict } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import { evaluatePremise } from './tolerance.js';
import { isBudgetExceeded, isIrreversible } from './budget.js';

/** Everything needed to derive `Verdict.logRef` for one completed decision. */
export interface LogRefInput {
  proposal: Proposal;
  policyHash: Hash32;
  outcome: 0 | 1 | 2;
  reasonCode: ReasonCode;
  /**
   * 0n when the verdict was decided before any checkpoint was ever pinned
   * (STALE_POLICY, POLICY_FORBIDDEN_ACTION) — those branches return before
   * step 3's `getCheckpoint()` call, by design (see `enforce`'s step 2
   * comment), so there is no real checkpoint value to report.
   */
  checkpoint: bigint;
}

/**
 * Everything `enforce()` needs from the outside world, dependency-injected
 * so this package has zero chain dependency and zero adapter dependency of
 * its own — it must never import `@bonded/intercepta-adapter`,
 * `@bonded/issuer-oracle`, a Sui SDK, or anything similar. See the file
 * header for why each shape is what it is.
 */
export interface EnforceDeps {
  /**
   * Resolves one premise definition to its currently-true value at the
   * pinned checkpoint `at`, or `null` if it cannot be resolved at all
   * (unknown schema, unknown field, adapter error). Routes to whichever
   * adapter owns `def.schema` — this package never inspects that string
   * itself, only passes it through.
   */
  resolvePremise(def: Premise, at: bigint): Promise<bigint | null>;
  /**
   * Pins ONE checkpoint for the entire proposal. Called at most once per
   * `enforce()` call, and ONLY after the forbidden-action check (step 2)
   * has passed — never called for a STALE_POLICY or POLICY_FORBIDDEN_ACTION
   * verdict.
   */
  getCheckpoint(): Promise<bigint>;
  /** Sum of `agent`'s already-recorded spend within the current `period`. */
  sumRecentSpend(agent: Address, period: string): Promise<bigint>;
  /**
   * Records a premise mismatch's claimed-vs-derived pair for the decision
   * log. Awaited before the REFUSED verdict is returned.
   */
  logMismatch(proposalId: Hash32, premiseId: string, claimedValue: string, derivedValue: string): Promise<void>;
  /**
   * Canonical hash of a `PolicyArtifact` — must match whatever on-chain
   * commitment scheme `onchainPolicyHash` was produced by, exactly.
   */
  canonicalHash(policy: PolicyArtifact): Hash32;
  /** Derives `Verdict.logRef` for a completed decision. See the file header. */
  computeLogRef(entry: LogRefInput): Hash32;
}

function buildVerdict(
  proposal: Proposal,
  policyHash: Hash32,
  outcome: 0 | 1 | 2,
  reasonCode: ReasonCode,
  blockChecked: bigint,
  computeLogRef: EnforceDeps['computeLogRef'],
): Verdict {
  const logRef = computeLogRef({ proposal, policyHash, outcome, reasonCode, checkpoint: blockChecked });
  return {
    proposalHash: proposal.id,
    policyHash,
    outcome,
    reasonCode,
    blockChecked,
    logRef,
  };
}

/** outcome 1 = REFUSED. */
function refuse(
  proposal: Proposal,
  policyHash: Hash32,
  reasonCode: ReasonCode,
  blockChecked: bigint,
  computeLogRef: EnforceDeps['computeLogRef'],
): Verdict {
  return buildVerdict(proposal, policyHash, 1, reasonCode, blockChecked, computeLogRef);
}

/** outcome 2 = HELD_FOR_STEPUP. */
function hold(
  proposal: Proposal,
  policyHash: Hash32,
  reasonCode: ReasonCode,
  blockChecked: bigint,
  computeLogRef: EnforceDeps['computeLogRef'],
): Verdict {
  return buildVerdict(proposal, policyHash, 2, reasonCode, blockChecked, computeLogRef);
}

/** outcome 0 = CLEARED. */
function clear(
  proposal: Proposal,
  policyHash: Hash32,
  blockChecked: bigint,
  computeLogRef: EnforceDeps['computeLogRef'],
): Verdict {
  return buildVerdict(proposal, policyHash, 0, ReasonCode.OK, blockChecked, computeLogRef);
}

/**
 * The five-step decision loop. See the file header for the one deliberate
 * deviation from D.2 (chain access and log-ref derivation are dependency-
 * injected) and this package's `enforce.test.ts` for what "done" means here
 * (PRD Part G row: Enforcer / `enforce.test.ts`).
 */
export async function enforce(
  proposal: Proposal,
  policy: PolicyArtifact,
  onchainPolicyHash: Hash32,
  deps: EnforceDeps,
): Promise<Verdict> {
  // Step 1 — fail closed if the policy has moved since the proposal was made.
  const policyHash = deps.canonicalHash(policy);
  if (policyHash !== onchainPolicyHash) {
    return refuse(proposal, policyHash, ReasonCode.STALE_POLICY, 0n, deps.computeLogRef);
  }

  // Step 2 — cheapest check first. An action that was never going to be
  // allowed, regardless of its premises, must never trigger a checkpoint
  // fetch or a premise resolution call below this line.
  if (policy.forbid.includes(proposal.action.kind)) {
    return refuse(proposal, policyHash, ReasonCode.POLICY_FORBIDDEN_ACTION, 0n, deps.computeLogRef);
  }

  // Step 3 — pin ONE checkpoint for the entire proposal, then resolve every
  // premise against that same pin. Resolving "now" once per premise would
  // open a race window between two premises checked moments apart; pinning
  // once closes it.
  const blockChecked = await deps.getCheckpoint();

  for (const claim of proposal.premises) {
    const def = policy.premises.find((p) => p.id === claim.premiseId);
    if (!def) {
      return refuse(proposal, policyHash, ReasonCode.PREMISE_UNRESOLVABLE, blockChecked, deps.computeLogRef);
    }

    const derived = await deps.resolvePremise(def, blockChecked); // no cache — see PRD D.3
    if (derived === null) {
      return refuse(proposal, policyHash, ReasonCode.PREMISE_UNRESOLVABLE, blockChecked, deps.computeLogRef);
    }

    const claimed = BigInt(claim.claimedValue);
    const ok = evaluatePremise(def, claimed, derived);

    if (!ok) {
      // Record BOTH values — this pair is what the premise diff table renders.
      await deps.logMismatch(proposal.id, def.id, claim.claimedValue, derived.toString());
      return refuse(proposal, policyHash, ReasonCode.PREMISE_MISMATCH, blockChecked, deps.computeLogRef);
    }
  }

  // Step 4 — budget check.
  const spent = await deps.sumRecentSpend(proposal.agent, policy.budget.period);
  const requested = BigInt(proposal.action.valueUSDC);
  if (isBudgetExceeded(spent, requested, BigInt(policy.budget.max))) {
    return refuse(proposal, policyHash, ReasonCode.BUDGET_EXCEEDED, blockChecked, deps.computeLogRef);
  }

  // Step 5 — irreversible threshold: hold for a step-up confirmation rather
  // than clearing autonomously.
  if (isIrreversible(requested, BigInt(policy.irreversibleAboveUSDC))) {
    return hold(proposal, policyHash, ReasonCode.IRREVERSIBLE_UNCONFIRMED, blockChecked, deps.computeLogRef);
  }

  return clear(proposal, policyHash, blockChecked, deps.computeLogRef);
}
