/**
 * Step-up gating, pure logic only. Nothing here submits a transaction.
 *
 * The `HandleCallbackResult` values below are plain inputs standing in for
 * "flow.ts#handleCallback already ran and returned this", the same
 * convention @bonded/world-agents' own stepup-gate tests use. They exercise
 * the gate's decision logic. They're never presented as a World
 * verification and never reach the chain. The live settle_with_stepup run
 * waits on real World sandbox credentials.
 */
import { describe, expect, it } from '@jest/globals';
import type { Hash32 } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import { STEPUP_FRESHNESS_WINDOW_MS, decideStepUp, type HeldProposal } from '@bonded/world-agents';
import {
  approveStepUpForSettlement,
  assertStepUpAuthorized,
  isCertifiedStepUpApproval,
  StepUpRefusedError,
  type CertifiedStepUpApproval,
} from '../stepup.js';
import { settleWithStepUp } from '../settle.js';
import { deriveVendorRecipient } from '../recipient.js';
import { clearedVerdict, heldVerdict, PROPOSAL_HASH } from './fixtures.js';

const NOW = 1_790_400_000_000;
const held: HeldProposal = { proposalHash: PROPOSAL_HASH, holdReason: ReasonCode.PREMISE_HELD_FOR_REVIEW };

function certify(authTimeMs = NOW, proposal: HeldProposal = held): CertifiedStepUpApproval {
  const d = approveStepUpForSettlement(proposal, { verified: true, sub: 'sub-1', authTimeMs }, NOW);
  if (!isCertifiedStepUpApproval(d)) throw new Error('expected a certified approval');
  return d;
}

describe('approveStepUpForSettlement', () => {
  it('certifies only what the real decideStepUp approved', () => {
    const d = certify();
    expect(d).toEqual(decideStepUp(held, { verified: true, sub: 'sub-1', authTimeMs: NOW }, NOW));
    expect(Object.isFrozen(d)).toBe(true);
  });

  it('passes a denial through uncertified', () => {
    const d = approveStepUpForSettlement(held, { denied: true, reason: 'access_denied' }, NOW);
    expect(d.approved).toBe(false);
    expect(isCertifiedStepUpApproval(d)).toBe(false);
  });

  it('does not certify an expired attempt or a stale proof', () => {
    expect(isCertifiedStepUpApproval(approveStepUpForSettlement(held, { expired: true }, NOW))).toBe(false);
    const stale = approveStepUpForSettlement(held, { verified: true, sub: 's', authTimeMs: NOW - STEPUP_FRESHNESS_WINDOW_MS - 1 }, NOW);
    expect(isCertifiedStepUpApproval(stale)).toBe(false);
  });
});

describe('assertStepUpAuthorized', () => {
  it('accepts a certified, fresh approval for the same proposal', () => {
    expect(() => assertStepUpAuthorized(heldVerdict(), certify(), NOW)).not.toThrow();
  });

  it('refuses a hand-built {approved: true} object', () => {
    const forged = { approved: true, proposalHash: PROPOSAL_HASH, sub: 'attacker', authTimeMs: NOW };
    expect(() => assertStepUpAuthorized(heldVerdict(), forged, NOW)).toThrow(/not produced by approveStepUpForSettlement/);
  });

  it('refuses a raw decideStepUp result that was not certified through this package', () => {
    const raw = decideStepUp(held, { verified: true, sub: 'sub-1', authTimeMs: NOW }, NOW);
    expect(raw.approved).toBe(true);
    expect(() => assertStepUpAuthorized(heldVerdict(), raw, NOW)).toThrow(StepUpRefusedError);
  });

  it('refuses a spread copy of a certified approval', () => {
    expect(() => assertStepUpAuthorized(heldVerdict(), { ...certify() }, NOW)).toThrow(/not produced by approveStepUpForSettlement/);
  });

  it('refuses a denied decision and names the reason', () => {
    const denied = approveStepUpForSettlement(held, { denied: true, reason: 'access_denied' }, NOW);
    expect(() => assertStepUpAuthorized(heldVerdict(), denied, NOW)).toThrow(/not approved \(access_denied\)/);
  });

  it('refuses a missing decision', () => {
    expect(() => assertStepUpAuthorized(heldVerdict(), undefined, NOW)).toThrow(/got none/);
  });

  it('refuses an approval certified for a different proposal', () => {
    const other: HeldProposal = { proposalHash: `0x${'09'.repeat(32)}` as Hash32, holdReason: ReasonCode.PREMISE_HELD_FOR_REVIEW };
    expect(() => assertStepUpAuthorized(heldVerdict(), certify(NOW, other), NOW)).toThrow(/is for proposal 0x0909/);
  });

  it('refuses an approval that was fresh when issued but has aged out by settle time', () => {
    const d = certify(NOW);
    expect(() => assertStepUpAuthorized(heldVerdict(), d, NOW + STEPUP_FRESHNESS_WINDOW_MS)).not.toThrow();
    expect(() => assertStepUpAuthorized(heldVerdict(), d, NOW + STEPUP_FRESHNESS_WINDOW_MS + 1)).toThrow(/no longer fresh/);
  });

  it('refuses a verdict that is not HELD_FOR_STEPUP', () => {
    expect(() => assertStepUpAuthorized(clearedVerdict(), certify(), NOW)).toThrow(/needs a HELD_FOR_STEPUP verdict/);
  });
});

describe('settleWithStepUp refuses before touching config or the CLI', () => {
  it('type-level: a raw StepUpGateDecision is not accepted', async () => {
    const recipient = await deriveVendorRecipient('vnd-globex-freight');
    const raw = decideStepUp(held, { verified: true, sub: 'sub-1', authTimeMs: NOW }, NOW);
    await expect(
      // @ts-expect-error StepUpGateDecision lacks the certification brand
      settleWithStepUp({ verdict: heldVerdict(), valueUsdc: 8_450_000_000n, recipient, stepUpDecision: raw }, { env: {}, nowMs: NOW }),
    ).rejects.toThrow(StepUpRefusedError);
  });

  it('a forged approval is refused with StepUpRefusedError, not a config error (so the gate runs first)', async () => {
    const recipient = await deriveVendorRecipient('vnd-globex-freight');
    const forged = { approved: true, proposalHash: PROPOSAL_HASH, sub: 'x', authTimeMs: NOW } as unknown as CertifiedStepUpApproval;
    await expect(
      settleWithStepUp({ verdict: heldVerdict(), valueUsdc: 8_450_000_000n, recipient, stepUpDecision: forged }, { env: {}, nowMs: NOW }),
    ).rejects.toThrow(StepUpRefusedError);
  });

  it('a certified approval passes the gate and then fails on missing config, naming the variable (no chain call)', async () => {
    const recipient = await deriveVendorRecipient('vnd-globex-freight');
    await expect(
      settleWithStepUp({ verdict: heldVerdict(), valueUsdc: 8_450_000_000n, recipient, stepUpDecision: certify() }, { env: {}, nowMs: NOW }),
    ).rejects.toThrow(/^SUI_BONDED_PACKAGE_ID is not set/);
  });
});
