/**
 * Pins the seam's wire shapes — Implementation PRD Part C.1, unchanged by
 * the Commerce Edition migration (Migration PRD Part D.2). These are
 * compile-time checks more than runtime assertions: if a shape drifts from
 * C.1, this file should fail to type-check under `tsconfig.test.json`.
 */

import type { Address, Hash32, Premise, PremiseOp, Proposal, PolicyArtifact, Verdict } from '../types.js';
import { ReasonCode } from '../types.js';

describe('ReasonCode', () => {
  it('has exactly the seven members of Part C.1, at their pinned numeric values', () => {
    expect(ReasonCode.OK).toBe(0);
    expect(ReasonCode.PREMISE_MISMATCH).toBe(1);
    expect(ReasonCode.PREMISE_UNRESOLVABLE).toBe(2);
    expect(ReasonCode.POLICY_FORBIDDEN_ACTION).toBe(3);
    expect(ReasonCode.BUDGET_EXCEEDED).toBe(4);
    expect(ReasonCode.STALE_POLICY).toBe(5);
    expect(ReasonCode.IRREVERSIBLE_UNCONFIRMED).toBe(6);

    const numeric = Object.values(ReasonCode).filter((v) => typeof v === 'number');
    expect(numeric).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('Premise', () => {
  it('carries `schema` as a plain string — new Commerce Edition schema names type-check with no import from an adapter package', () => {
    const premises: Premise[] = [
      { id: 'p1', schema: 'intercepta-risk', field: 'payment.payTo.riskScore', op: 'lte', value: '2500' },
      { id: 'p2', schema: 'issuer-oracle-tickets', field: 'ticket.faceValueUSD', op: 'eq', value: '45000000', toleranceBps: 0 },
      { id: 'p3', schema: 'issuer-oracle-ecomm', field: 'item.priceUSD', op: 'eq', value: '9990000' },
      // an unrecognized schema string still type-checks: enforce() has zero
      // knowledge of, or dependency on, the set of valid schema names.
      { id: 'p4', schema: 'anything-at-all', field: 'x', op: 'gte', value: '0' },
    ];
    expect(premises).toHaveLength(4);
    const ops: PremiseOp[] = ['gte', 'lte', 'eq', 'older_than', 'younger_than'];
    expect(ops).toHaveLength(5);
  });
});

describe('Proposal', () => {
  it('encodes all money amounts as strings, never number', () => {
    const proposal: Proposal = {
      id: `0x${'ab'.repeat(32)}` as Hash32,
      agent: `0x${'01'.repeat(20)}` as Address,
      action: {
        kind: 'transfer',
        target: `0x${'02'.repeat(20)}` as Address,
        calldata: '0x',
        valueUSDC: '45000000',
      },
      premises: [{ premiseId: 'p1', claimedValue: '45000000' }],
      createdAt: 1_758_000_000,
    };
    expect(typeof proposal.action.valueUSDC).toBe('string');
    expect(typeof proposal.premises[0]?.claimedValue).toBe('string');

    // @ts-expect-error — valueUSDC must be a string, never a number
    const bad: Proposal = { ...proposal, action: { ...proposal.action, valueUSDC: 45_000_000 } };
    expect(bad).toBeDefined();
  });
});

describe('Verdict', () => {
  it('carries blockChecked as bigint and outcome as the 0|1|2 literal union', () => {
    const verdict: Verdict = {
      proposalHash: `0x${'ab'.repeat(32)}` as Hash32,
      policyHash: `0x${'cd'.repeat(32)}` as Hash32,
      outcome: 0,
      reasonCode: ReasonCode.OK,
      blockChecked: 123_456n,
      logRef: `0x${'ef'.repeat(32)}` as Hash32,
    };
    expect(typeof verdict.blockChecked).toBe('bigint');

    // @ts-expect-error — blockChecked must be bigint, never a number
    const bad: Verdict = { ...verdict, blockChecked: 123_456 };
    expect(bad).toBeDefined();

    // @ts-expect-error — outcome is 0 | 1 | 2 only
    const badOutcome: Verdict = { ...verdict, outcome: 3 };
    expect(badOutcome).toBeDefined();
  });
});

describe('PolicyArtifact', () => {
  it('encodes budget.max and irreversibleAboveUSDC as strings', () => {
    const policy: PolicyArtifact = {
      version: 1,
      budget: { asset: 'USDC', period: 'daily', max: '500000000' },
      premises: [],
      forbid: ['self-destruct'],
      irreversibleAboveUSDC: '100000000',
    };
    expect(typeof policy.budget.max).toBe('string');
    expect(typeof policy.irreversibleAboveUSDC).toBe('string');
  });
});
