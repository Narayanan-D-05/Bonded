/**
 * Pure-logic tests for `stepup-gate.ts`: freshness-window boundaries and the denied-reason
 * mapping from `flow.ts#handleCallback` outcomes. Nothing here touches the network or a
 * store, and nothing here constructs or asserts a World-signed token — only plain fixture
 * values standing in for "a handleCallback call already happened and returned this."
 */
import { ReasonCode, type Verdict } from '@bonded/seam';
import {
  STEPUP_FRESHNESS_WINDOW_MS,
  decideStepUp,
  freshnessProblem,
  fromHeldVerdict,
  HeldProposalError,
  type HeldProposal,
} from '../stepup-gate.js';
import type { HandleCallbackResult } from '../flow.js';

const HASH = ('0x' + '22'.repeat(32)) as `0x${string}`;
const NOW_MS = 1_800_000_000_000;

function proposal(extra: Partial<HeldProposal> = {}): HeldProposal {
  return { proposalHash: HASH, holdReason: ReasonCode.IRREVERSIBLE_UNCONFIRMED, ...extra };
}

function heldVerdict(extra: Partial<Verdict> = {}): Verdict {
  return {
    proposalHash: HASH,
    policyHash: ('0x' + '33'.repeat(32)) as `0x${string}`,
    outcome: 2,
    reasonCode: ReasonCode.IRREVERSIBLE_UNCONFIRMED,
    blockChecked: 123n,
    logRef: ('0x' + '44'.repeat(32)) as `0x${string}`,
    ...extra,
  };
}

describe('freshnessProblem — boundary values', () => {
  test('exactly at the window edge is accepted (inclusive)', () => {
    const authTimeMs = NOW_MS - STEPUP_FRESHNESS_WINDOW_MS;
    expect(freshnessProblem(authTimeMs, NOW_MS)).toBeNull();
  });

  test('one millisecond past the window edge is rejected', () => {
    const authTimeMs = NOW_MS - STEPUP_FRESHNESS_WINDOW_MS - 1;
    expect(freshnessProblem(authTimeMs, NOW_MS)).not.toBeNull();
  });

  test('one millisecond inside the window edge is accepted', () => {
    const authTimeMs = NOW_MS - STEPUP_FRESHNESS_WINDOW_MS + 1;
    expect(freshnessProblem(authTimeMs, NOW_MS)).toBeNull();
  });

  test('auth_time exactly now is accepted', () => {
    expect(freshnessProblem(NOW_MS, NOW_MS)).toBeNull();
  });

  test('auth_time within clock-skew tolerance in the future is accepted', () => {
    expect(freshnessProblem(NOW_MS + 29_000, NOW_MS, STEPUP_FRESHNESS_WINDOW_MS, 30_000)).toBeNull();
  });

  test('auth_time beyond clock-skew tolerance in the future is rejected', () => {
    expect(freshnessProblem(NOW_MS + 31_000, NOW_MS, STEPUP_FRESHNESS_WINDOW_MS, 30_000)).not.toBeNull();
  });

  test('a custom window is honored', () => {
    const authTimeMs = NOW_MS - 60_000;
    expect(freshnessProblem(authTimeMs, NOW_MS, 30_000)).not.toBeNull();
    expect(freshnessProblem(authTimeMs, NOW_MS, 120_000)).toBeNull();
  });
});

describe('decideStepUp — the expired/denied passthrough', () => {
  test('{ expired: true } from handleCallback becomes reason token_expired', () => {
    const result: HandleCallbackResult = { expired: true };
    const decision = decideStepUp(proposal(), result, NOW_MS);
    expect(decision).toMatchObject({ approved: false, reason: 'token_expired' });
  });

  const denialCases: Array<[string, string]> = [
    ['access_denied', 'access_denied'],
    ['state_mismatch', 'state_mismatch'],
    ['malformed_callback', 'state_mismatch'],
    ['nonce_mismatch', 'nonce_mismatch'],
    ['replayed_code', 'replayed_code'],
    ['replayed_nonce', 'replayed_code'],
    ['token_exchange_failed', 'token_exchange_failed'],
    ['idp_unavailable', 'idp_unavailable'],
    ['token_invalid', 'token_invalid'],
    ['assurance_mismatch', 'assurance_mismatch'],
    ['attempt_expired', 'token_expired'],
    ['token_expired', 'token_expired'],
  ];

  for (const [raw, expected] of denialCases) {
    test(`handleCallback denied reason "${raw}" maps to gate reason "${expected}"`, () => {
      const result: HandleCallbackResult = { denied: true, reason: raw };
      const decision = decideStepUp(proposal(), result, NOW_MS);
      expect(decision).toMatchObject({ approved: false, reason: expected });
    });
  }

  test('an unrecognized denial reason still denies, mapped to token_invalid, never throws', () => {
    const result: HandleCallbackResult = { denied: true, reason: 'some_future_reason_not_yet_known' };
    expect(() => decideStepUp(proposal(), result, NOW_MS)).not.toThrow();
    const decision = decideStepUp(proposal(), result, NOW_MS);
    expect(decision).toMatchObject({ approved: false, reason: 'token_invalid' });
  });
});

describe('decideStepUp — fresh, verified approval', () => {
  test('a fresh verified callback with no boundSub is approved for any sub', () => {
    const result: HandleCallbackResult = { verified: true, sub: 'sub-abc', authTimeMs: NOW_MS - 1000 };
    const decision = decideStepUp(proposal(), result, NOW_MS);
    expect(decision).toEqual({ approved: true, proposalHash: HASH, sub: 'sub-abc', authTimeMs: NOW_MS - 1000 });
  });

  test('a stale verified callback (past the freshness window) is denied stale_authentication', () => {
    const result: HandleCallbackResult = { verified: true, sub: 'sub-abc', authTimeMs: NOW_MS - STEPUP_FRESHNESS_WINDOW_MS - 1 };
    const decision = decideStepUp(proposal(), result, NOW_MS);
    expect(decision).toMatchObject({ approved: false, reason: 'stale_authentication' });
  });
});

describe('decideStepUp — optional boundSub (no owner-binding requirement by default)', () => {
  test('boundSub unset: a different sub each time is still approved (no identity-continuity requirement)', () => {
    const result: HandleCallbackResult = { verified: true, sub: 'sub-anyone', authTimeMs: NOW_MS };
    const decision = decideStepUp(proposal(), result, NOW_MS);
    expect(decision.approved).toBe(true);
  });

  test('boundSub set and matching: approved', () => {
    const result: HandleCallbackResult = { verified: true, sub: 'sub-owner', authTimeMs: NOW_MS };
    const decision = decideStepUp(proposal({ boundSub: 'sub-owner' }), result, NOW_MS);
    expect(decision.approved).toBe(true);
  });

  test('boundSub set and mismatched: denied sub_mismatch', () => {
    const result: HandleCallbackResult = { verified: true, sub: 'sub-intruder', authTimeMs: NOW_MS };
    const decision = decideStepUp(proposal({ boundSub: 'sub-owner' }), result, NOW_MS);
    expect(decision).toMatchObject({ approved: false, reason: 'sub_mismatch' });
  });

  test('freshness is still checked even when boundSub matches', () => {
    const result: HandleCallbackResult = {
      verified: true,
      sub: 'sub-owner',
      authTimeMs: NOW_MS - STEPUP_FRESHNESS_WINDOW_MS - 1,
    };
    const decision = decideStepUp(proposal({ boundSub: 'sub-owner' }), result, NOW_MS);
    expect(decision).toMatchObject({ approved: false, reason: 'stale_authentication' });
  });
});

describe('fromHeldVerdict — building a HeldProposal from the enforcer\'s real Verdict type', () => {
  test('a genuine HELD_FOR_STEPUP / IRREVERSIBLE_UNCONFIRMED verdict converts cleanly', () => {
    const held = fromHeldVerdict(heldVerdict());
    expect(held).toEqual({ proposalHash: HASH, holdReason: ReasonCode.IRREVERSIBLE_UNCONFIRMED });
  });

  test('boundSub is carried through when supplied', () => {
    const held = fromHeldVerdict(heldVerdict(), 'sub-owner');
    expect(held.boundSub).toBe('sub-owner');
  });

  test('a CLEARED verdict (outcome 0) is refused — this gate never clears a routine verdict', () => {
    expect(() => fromHeldVerdict(heldVerdict({ outcome: 0 }))).toThrow(HeldProposalError);
  });

  test('a REFUSED verdict (outcome 1) is refused', () => {
    expect(() => fromHeldVerdict(heldVerdict({ outcome: 1 }))).toThrow(HeldProposalError);
  });

  test('a HELD_FOR_STEPUP verdict with a different reasonCode (e.g. BUDGET_EXCEEDED) is refused', () => {
    expect(() => fromHeldVerdict(heldVerdict({ reasonCode: ReasonCode.BUDGET_EXCEEDED }))).toThrow(HeldProposalError);
  });

  test('a genuine HELD_FOR_STEPUP / PREMISE_HELD_FOR_REVIEW verdict converts cleanly, with holdReason set to the reason it actually was', () => {
    const held = fromHeldVerdict(heldVerdict({ reasonCode: ReasonCode.PREMISE_HELD_FOR_REVIEW }));
    expect(held).toEqual({ proposalHash: HASH, holdReason: ReasonCode.PREMISE_HELD_FOR_REVIEW });
  });
});
