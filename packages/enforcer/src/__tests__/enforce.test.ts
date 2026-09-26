/**
 * PRD Part G row: Enforcer / `enforce.test.ts` — "Every `ReasonCode` branch
 * is independently reachable; step order matches D.2 exactly (forbidden-
 * action check never reaches a Graph query)." In this migration "a Graph
 * query" is `deps.resolvePremise`/`deps.getCheckpoint` — see `enforce.ts`'s
 * file header for why those are dependency-injected instead of chain calls.
 */

import { jest } from '@jest/globals';
import type { Address, Hash32, PolicyArtifact, Proposal } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import { enforce, type EnforceDeps, type LogRefInput } from '../enforce.js';

const AGENT = `0x${'01'.repeat(20)}` as Address;
const TARGET = `0x${'02'.repeat(20)}` as Address;
const PROPOSAL_ID = `0x${'ab'.repeat(32)}` as Hash32;
const POLICY_HASH = `0x${'cd'.repeat(32)}` as Hash32;
const OTHER_HASH = `0x${'99'.repeat(32)}` as Hash32;
const LOG_REF = `0x${'ef'.repeat(32)}` as Hash32;
const CHECKPOINT = 42n;

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: PROPOSAL_ID,
    agent: AGENT,
    action: {
      kind: 'transfer',
      target: TARGET,
      calldata: '0x',
      valueUSDC: '10000000', // $10
    },
    premises: [{ premiseId: 'p1', claimedValue: '45000000' }],
    createdAt: 1_758_000_000,
    ...overrides,
  };
}

function makePolicy(overrides: Partial<PolicyArtifact> = {}): PolicyArtifact {
  return {
    version: 1,
    budget: { asset: 'USDC', period: 'daily', max: '100000000' }, // $100
    premises: [{ id: 'p1', schema: 'issuer-oracle-tickets', field: 'ticket.faceValueUSD', op: 'eq', value: '', toleranceBps: 0 }],
    forbid: ['self-destruct'],
    irreversibleAboveUSDC: '50000000', // $50
    ...overrides,
  };
}

function makeDeps(overrides: Partial<EnforceDeps> = {}): EnforceDeps {
  return {
    resolvePremise: jest.fn(async () => 45_000_000n),
    getCheckpoint: jest.fn(async () => CHECKPOINT),
    sumRecentSpend: jest.fn(async () => 0n),
    logMismatch: jest.fn(async () => {}),
    canonicalHash: jest.fn(() => POLICY_HASH),
    computeLogRef: jest.fn((_entry: LogRefInput) => LOG_REF),
    ...overrides,
  };
}

describe('enforce — every ReasonCode branch', () => {
  it('OK / CLEARED: all checks pass', async () => {
    const deps = makeDeps();
    const verdict = await enforce(makeProposal(), makePolicy(), POLICY_HASH, deps);

    expect(verdict.outcome).toBe(0);
    expect(verdict.reasonCode).toBe(ReasonCode.OK);
    expect(verdict.proposalHash).toBe(PROPOSAL_ID);
    expect(verdict.policyHash).toBe(POLICY_HASH);
    expect(verdict.blockChecked).toBe(CHECKPOINT);
    expect(verdict.logRef).toBe(LOG_REF);
    expect(typeof verdict.blockChecked).toBe('bigint');
  });

  it('STALE_POLICY: onchain hash does not match the recomputed policy hash', async () => {
    const deps = makeDeps();
    const verdict = await enforce(makeProposal(), makePolicy(), OTHER_HASH, deps);

    expect(verdict.outcome).toBe(1); // REFUSED
    expect(verdict.reasonCode).toBe(ReasonCode.STALE_POLICY);
    expect(verdict.blockChecked).toBe(0n); // never got to step 3
    expect(deps.getCheckpoint).not.toHaveBeenCalled();
    expect(deps.resolvePremise).not.toHaveBeenCalled();
  });

  it('POLICY_FORBIDDEN_ACTION: refused before any checkpoint fetch or premise resolution', async () => {
    // Resolver/checkpoint throw if invoked at all — the strongest possible
    // proof that step 2 never reaches step 3, per the PRD's own testing bar.
    const deps = makeDeps({
      resolvePremise: jest.fn(async () => {
        throw new Error('must not be called: forbidden-action check must short-circuit before premise resolution');
      }),
      getCheckpoint: jest.fn(async () => {
        throw new Error('must not be called: forbidden-action check must short-circuit before the checkpoint pin');
      }),
    });
    const proposal = makeProposal({ action: { kind: 'self-destruct', target: TARGET, calldata: '0x', valueUSDC: '10000000' } });

    const verdict = await enforce(proposal, makePolicy(), POLICY_HASH, deps);

    expect(verdict.outcome).toBe(1); // REFUSED
    expect(verdict.reasonCode).toBe(ReasonCode.POLICY_FORBIDDEN_ACTION);
    expect(verdict.blockChecked).toBe(0n);
    expect(deps.getCheckpoint).not.toHaveBeenCalled();
    expect(deps.resolvePremise).not.toHaveBeenCalled();
  });

  it('PREMISE_UNRESOLVABLE: the claimed premiseId has no matching definition in the policy', async () => {
    const deps = makeDeps();
    const proposal = makeProposal({ premises: [{ premiseId: 'no-such-premise', claimedValue: '1' }] });

    const verdict = await enforce(proposal, makePolicy(), POLICY_HASH, deps);

    expect(verdict.outcome).toBe(1);
    expect(verdict.reasonCode).toBe(ReasonCode.PREMISE_UNRESOLVABLE);
    expect(verdict.blockChecked).toBe(CHECKPOINT);
    expect(deps.resolvePremise).not.toHaveBeenCalled();
  });

  it('PREMISE_UNRESOLVABLE: resolvePremise itself returns null', async () => {
    const deps = makeDeps({ resolvePremise: jest.fn(async () => null) });

    const verdict = await enforce(makeProposal(), makePolicy(), POLICY_HASH, deps);

    expect(verdict.outcome).toBe(1);
    expect(verdict.reasonCode).toBe(ReasonCode.PREMISE_UNRESOLVABLE);
    expect(deps.resolvePremise).toHaveBeenCalledWith(makePolicy().premises[0], CHECKPOINT);
  });

  it('PREMISE_MISMATCH: derived value disagrees with the claimed value, and logMismatch records both', async () => {
    const deps = makeDeps({ resolvePremise: jest.fn(async () => 99_000_000n) }); // claim says 45000000
    const proposal = makeProposal({ premises: [{ premiseId: 'p1', claimedValue: '45000000' }] });

    const verdict = await enforce(proposal, makePolicy(), POLICY_HASH, deps);

    expect(verdict.outcome).toBe(1);
    expect(verdict.reasonCode).toBe(ReasonCode.PREMISE_MISMATCH);
    expect(deps.logMismatch).toHaveBeenCalledWith(PROPOSAL_ID, 'p1', '45000000', '99000000');
  });

  it('BUDGET_EXCEEDED: spent + requested is one unit over max', async () => {
    const deps = makeDeps({ sumRecentSpend: jest.fn(async () => 90_000_001n) }); // + 10000000 requested = 100000001 > 100000000 max
    const verdict = await enforce(makeProposal(), makePolicy(), POLICY_HASH, deps);

    expect(verdict.outcome).toBe(1);
    expect(verdict.reasonCode).toBe(ReasonCode.BUDGET_EXCEEDED);
  });

  it('IRREVERSIBLE_UNCONFIRMED: requested is one unit over the irreversible threshold -> HELD_FOR_STEPUP', async () => {
    const deps = makeDeps();
    const proposal = makeProposal({ action: { kind: 'transfer', target: TARGET, calldata: '0x', valueUSDC: '50000001' } }); // threshold is 50000000
    const verdict = await enforce(proposal, makePolicy(), POLICY_HASH, deps);

    expect(verdict.outcome).toBe(2); // HELD_FOR_STEPUP
    expect(verdict.reasonCode).toBe(ReasonCode.IRREVERSIBLE_UNCONFIRMED);
  });
});

describe('enforce — holdOnMismatch (Commerce Edition B2B/AP correction)', () => {
  it('a holdOnMismatch premise that mismatches produces HELD_FOR_STEPUP / PREMISE_HELD_FOR_REVIEW, and logMismatch is called with both claimed and derived values', async () => {
    const deps = makeDeps({ resolvePremise: jest.fn(async () => 99_000_000n) }); // claim says 45000000
    const policy = makePolicy({
      premises: [{ id: 'p1', schema: 'issuer-oracle-vendors', field: 'vendor.payoutAddress', op: 'eq', value: '', holdOnMismatch: true }],
    });
    const proposal = makeProposal({ premises: [{ premiseId: 'p1', claimedValue: '45000000' }] });

    const verdict = await enforce(proposal, policy, POLICY_HASH, deps);

    expect(verdict.outcome).toBe(2); // HELD_FOR_STEPUP
    expect(verdict.reasonCode).toBe(ReasonCode.PREMISE_HELD_FOR_REVIEW);
    expect(deps.logMismatch).toHaveBeenCalledWith(PROPOSAL_ID, 'p1', '45000000', '99000000');
  });

  it('regression: the same mismatch with holdOnMismatch unset still hard-refuses', async () => {
    const deps = makeDeps({ resolvePremise: jest.fn(async () => 99_000_000n) });
    const policy = makePolicy({
      premises: [{ id: 'p1', schema: 'issuer-oracle-vendors', field: 'vendor.payoutAddress', op: 'eq', value: '' }],
    });
    const proposal = makeProposal({ premises: [{ premiseId: 'p1', claimedValue: '45000000' }] });

    const verdict = await enforce(proposal, policy, POLICY_HASH, deps);

    expect(verdict.outcome).toBe(1); // REFUSED
    expect(verdict.reasonCode).toBe(ReasonCode.PREMISE_MISMATCH);
  });

  it('regression: the same mismatch with holdOnMismatch explicitly false still hard-refuses', async () => {
    const deps = makeDeps({ resolvePremise: jest.fn(async () => 99_000_000n) });
    const policy = makePolicy({
      premises: [{ id: 'p1', schema: 'issuer-oracle-vendors', field: 'vendor.payoutAddress', op: 'eq', value: '', holdOnMismatch: false }],
    });
    const proposal = makeProposal({ premises: [{ premiseId: 'p1', claimedValue: '45000000' }] });

    const verdict = await enforce(proposal, policy, POLICY_HASH, deps);

    expect(verdict.outcome).toBe(1); // REFUSED
    expect(verdict.reasonCode).toBe(ReasonCode.PREMISE_MISMATCH);
  });

  it('step order: budget/irreversible checks are never reached after a hold-branch return', async () => {
    const deps = makeDeps({
      resolvePremise: jest.fn(async () => 99_000_000n), // mismatches -> hold, must short-circuit
      sumRecentSpend: jest.fn(async () => {
        throw new Error('must not be called: a hold-branch return must short-circuit before the budget check');
      }),
    });
    const policy = makePolicy({
      premises: [{ id: 'p1', schema: 'issuer-oracle-vendors', field: 'vendor.payoutAddress', op: 'eq', value: '', holdOnMismatch: true }],
    });
    const proposal = makeProposal({ premises: [{ premiseId: 'p1', claimedValue: '45000000' }] });

    const verdict = await enforce(proposal, policy, POLICY_HASH, deps);

    expect(verdict.outcome).toBe(2);
    expect(verdict.reasonCode).toBe(ReasonCode.PREMISE_HELD_FOR_REVIEW);
    expect(deps.sumRecentSpend).not.toHaveBeenCalled();
  });

  it('multi-premise ordering: an earlier plain-mismatch premise still wins (hard refuse) over a later holdOnMismatch one', async () => {
    const deps = makeDeps({
      resolvePremise: jest
        .fn<EnforceDeps['resolvePremise']>()
        .mockResolvedValueOnce(99_000_000n) // p1 (plain) mismatches first
        .mockResolvedValueOnce(1_000_000n), // p2 (holdOnMismatch) would also mismatch, but never reached
    });
    const policy = makePolicy({
      premises: [
        { id: 'p1', schema: 'issuer-oracle-tickets', field: 'a', op: 'eq', value: '', toleranceBps: 0 },
        { id: 'p2', schema: 'issuer-oracle-vendors', field: 'vendor.payoutAddress', op: 'eq', value: '', holdOnMismatch: true },
      ],
    });
    const proposal = makeProposal({
      premises: [
        { premiseId: 'p1', claimedValue: '45000000' },
        { premiseId: 'p2', claimedValue: '45000000' },
      ],
    });

    const verdict = await enforce(proposal, policy, POLICY_HASH, deps);

    expect(verdict.outcome).toBe(1); // REFUSED — the earlier plain mismatch wins
    expect(verdict.reasonCode).toBe(ReasonCode.PREMISE_MISMATCH);
    expect(deps.resolvePremise).toHaveBeenCalledTimes(1); // never got to p2
  });

  it('categorical eq premise (string derived) passes and fails correctly through the real string branch', async () => {
    const policy = makePolicy({
      premises: [{ id: 'p1', schema: 'issuer-oracle-vendors', field: 'vendor.status', op: 'eq', value: '' }],
    });

    const passDeps = makeDeps({ resolvePremise: jest.fn(async () => 'active') });
    const passProposal = makeProposal({ premises: [{ premiseId: 'p1', claimedValue: 'active' }] });
    const passVerdict = await enforce(passProposal, policy, POLICY_HASH, passDeps);
    expect(passVerdict.outcome).toBe(0); // CLEARED
    expect(passVerdict.reasonCode).toBe(ReasonCode.OK);

    const failDeps = makeDeps({ resolvePremise: jest.fn(async () => 'suspended') });
    const failProposal = makeProposal({ premises: [{ premiseId: 'p1', claimedValue: 'active' }] });
    const failVerdict = await enforce(failProposal, policy, POLICY_HASH, failDeps);
    expect(failVerdict.outcome).toBe(1); // REFUSED
    expect(failVerdict.reasonCode).toBe(ReasonCode.PREMISE_MISMATCH);
    expect(failDeps.logMismatch).toHaveBeenCalledWith(PROPOSAL_ID, 'p1', 'active', 'suspended');
  });

  it('categorical eq premise with holdOnMismatch: passes and fails correctly through the string branch, held variant', async () => {
    const policy = makePolicy({
      premises: [{ id: 'p1', schema: 'issuer-oracle-vendors', field: 'vendor.status', op: 'eq', value: '', holdOnMismatch: true }],
    });

    const passDeps = makeDeps({ resolvePremise: jest.fn(async () => 'active') });
    const passProposal = makeProposal({ premises: [{ premiseId: 'p1', claimedValue: 'active' }] });
    const passVerdict = await enforce(passProposal, policy, POLICY_HASH, passDeps);
    expect(passVerdict.outcome).toBe(0); // CLEARED — no mismatch, hold never triggers
    expect(passVerdict.reasonCode).toBe(ReasonCode.OK);

    const failDeps = makeDeps({ resolvePremise: jest.fn(async () => 'suspended') });
    const failProposal = makeProposal({ premises: [{ premiseId: 'p1', claimedValue: 'active' }] });
    const failVerdict = await enforce(failProposal, policy, POLICY_HASH, failDeps);
    expect(failVerdict.outcome).toBe(2); // HELD_FOR_STEPUP
    expect(failVerdict.reasonCode).toBe(ReasonCode.PREMISE_HELD_FOR_REVIEW);
    expect(failDeps.logMismatch).toHaveBeenCalledWith(PROPOSAL_ID, 'p1', 'active', 'suspended');
  });
});

describe('enforce — step order (D.2 exactly)', () => {
  it('never calls resolvePremise or getCheckpoint for a stale policy', async () => {
    const deps = makeDeps();
    await enforce(makeProposal(), makePolicy(), OTHER_HASH, deps);
    expect(deps.getCheckpoint).not.toHaveBeenCalled();
    expect(deps.resolvePremise).not.toHaveBeenCalled();
    expect(deps.sumRecentSpend).not.toHaveBeenCalled();
    expect(deps.logMismatch).not.toHaveBeenCalled();
  });

  it('never calls resolvePremise, getCheckpoint, or sumRecentSpend for a forbidden action', async () => {
    const deps = makeDeps();
    const proposal = makeProposal({ action: { kind: 'self-destruct', target: TARGET, calldata: '0x', valueUSDC: '10000000' } });
    await enforce(proposal, makePolicy(), POLICY_HASH, deps);
    expect(deps.getCheckpoint).not.toHaveBeenCalled();
    expect(deps.resolvePremise).not.toHaveBeenCalled();
    expect(deps.sumRecentSpend).not.toHaveBeenCalled();
  });

  it('calls getCheckpoint exactly once even with multiple premises (pinned once, not per-premise)', async () => {
    const deps = makeDeps();
    const policy = makePolicy({
      premises: [
        { id: 'p1', schema: 'issuer-oracle-tickets', field: 'a', op: 'eq', value: '', toleranceBps: 0 },
        { id: 'p2', schema: 'issuer-oracle-tickets', field: 'b', op: 'eq', value: '', toleranceBps: 0 },
      ],
    });
    const proposal = makeProposal({
      premises: [
        { premiseId: 'p1', claimedValue: '45000000' },
        { premiseId: 'p2', claimedValue: '45000000' },
      ],
    });

    await enforce(proposal, policy, POLICY_HASH, deps);

    expect(deps.getCheckpoint).toHaveBeenCalledTimes(1);
    expect(deps.resolvePremise).toHaveBeenCalledTimes(2);
  });

  it('does not evaluate the budget check before every premise has resolved', async () => {
    const deps = makeDeps({ resolvePremise: jest.fn(async () => null) }); // first premise unresolvable
    await enforce(makeProposal(), makePolicy(), POLICY_HASH, deps);
    expect(deps.sumRecentSpend).not.toHaveBeenCalled();
  });

  it('does not evaluate the irreversible threshold before the budget check passes', async () => {
    const deps = makeDeps({ sumRecentSpend: jest.fn(async () => 90_000_001n) }); // budget exceeded
    const proposal = makeProposal({ action: { kind: 'transfer', target: TARGET, calldata: '0x', valueUSDC: '50000001' } }); // would also be over the irreversible threshold
    const verdict = await enforce(proposal, makePolicy(), POLICY_HASH, deps);
    // budget is checked first: this must refuse for BUDGET_EXCEEDED, not hold for IRREVERSIBLE_UNCONFIRMED
    expect(verdict.reasonCode).toBe(ReasonCode.BUDGET_EXCEEDED);
    expect(verdict.outcome).toBe(1);
  });
});

describe('enforce — budget boundary (step 4)', () => {
  it('exactly equal to max passes (does not exceed)', async () => {
    // spent + requested === max exactly: 90000000 + 10000000 = 100000000 === max
    const deps = makeDeps({ sumRecentSpend: jest.fn(async () => 90_000_000n) });
    const verdict = await enforce(makeProposal(), makePolicy(), POLICY_HASH, deps);
    expect(verdict.reasonCode).not.toBe(ReasonCode.BUDGET_EXCEEDED);
    expect(verdict.reasonCode).toBe(ReasonCode.OK); // $10 requested is also under the $50 irreversible threshold
  });

  it('one unit over max fails', async () => {
    const deps = makeDeps({ sumRecentSpend: jest.fn(async () => 90_000_001n) });
    const verdict = await enforce(makeProposal(), makePolicy(), POLICY_HASH, deps);
    expect(verdict.reasonCode).toBe(ReasonCode.BUDGET_EXCEEDED);
  });
});

describe('enforce — irreversible-threshold boundary (step 5, strict >)', () => {
  it('exactly equal to the threshold does NOT hold — it clears', async () => {
    const deps = makeDeps();
    const proposal = makeProposal({ action: { kind: 'transfer', target: TARGET, calldata: '0x', valueUSDC: '50000000' } }); // === threshold
    const verdict = await enforce(proposal, makePolicy(), POLICY_HASH, deps);
    expect(verdict.outcome).toBe(0); // CLEARED
    expect(verdict.reasonCode).toBe(ReasonCode.OK);
  });

  it('one unit above the threshold holds for step-up', async () => {
    const deps = makeDeps();
    const proposal = makeProposal({ action: { kind: 'transfer', target: TARGET, calldata: '0x', valueUSDC: '50000001' } }); // threshold + 1
    const verdict = await enforce(proposal, makePolicy(), POLICY_HASH, deps);
    expect(verdict.outcome).toBe(2); // HELD_FOR_STEPUP
    expect(verdict.reasonCode).toBe(ReasonCode.IRREVERSIBLE_UNCONFIRMED);
  });
});

describe('enforce — logRef derivation', () => {
  it('passes computeLogRef the proposal, policyHash, outcome, reasonCode, and checkpoint used for the decision', async () => {
    const deps = makeDeps();
    await enforce(makeProposal(), makePolicy(), POLICY_HASH, deps);
    expect(deps.computeLogRef).toHaveBeenCalledWith({
      proposal: makeProposal(),
      policyHash: POLICY_HASH,
      outcome: 0,
      reasonCode: ReasonCode.OK,
      checkpoint: CHECKPOINT,
    });
  });

  it('uses checkpoint 0n when computeLogRef is invoked before step 3 (STALE_POLICY)', async () => {
    const deps = makeDeps();
    await enforce(makeProposal(), makePolicy(), OTHER_HASH, deps);
    expect(deps.computeLogRef).toHaveBeenCalledWith(
      expect.objectContaining({ checkpoint: 0n, reasonCode: ReasonCode.STALE_POLICY }),
    );
  });
});
