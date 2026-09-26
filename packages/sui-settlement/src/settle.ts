/**
 * The four exported operations: settle a CLEARED verdict, settle a
 * World-approved HELD verdict, commit a policy hash, and read one back.
 *
 * Order inside every settle path is deliberate: pure checks first (the
 * recipient was re-derived, the amount is a u64 bigint, the verdict outcome
 * matches, and for step-up the certified World approval), then config, then
 * the CLI. A refusal never reaches the network, and never loads config.
 *
 * RECIPIENT RULE (see recipient.ts for the full reasoning): `recipient` is
 * always a `DerivedRecipient`, the vendor's payout address re-derived from
 * the vendor-master source at settle time. It's never the address an
 * invoice claimed. Settlement pays the truth, not the claim.
 */

import type { Address, Hash32, Verdict } from '@bonded/seam';
import { loadSettlementConfig, type SettlementConfig } from './config.js';
import { executePtb } from './cli.js';
import {
  confirmSettlement,
  explorerTxUrl,
  gasSummary,
  readPolicyHash as readPolicyHashWithConfig,
  readVaultSpentThisPeriod as readVaultSpentWithConfig,
  registryAgentKey,
  type GasSummary,
  type SettledEvent,
} from './chain.js';
import {
  assertU64Amount,
  buildCommitPolicyArgs,
  buildSettleClearedArgs,
  buildSettleWithStepUpArgs,
  hash32ToVecLiteral,
  OUTCOME_CLEARED,
  PtbArgumentError,
} from './ptb.js';
import { assertDerivedRecipient, type DerivedRecipient } from './recipient.js';
import { assertStepUpAuthorized, type CertifiedStepUpApproval } from './stepup.js';

export interface SettlementResult {
  digest: string;
  explorerUrl: string;
  vendorId: string;
  recipient: Address;
  valueUsdc: bigint;
  settled: SettledEvent;
  recipientBalanceDelta: bigint;
  payoutCoinId: string;
  payoutCoinBalance: bigint;
  gas: GasSummary;
}

export interface CommitPolicyResult {
  digest: string;
  explorerUrl: string;
  /** The 32-byte registry key actually written (a shorter agent address is zero-left-padded). */
  agentKey: string;
  policyHash: Hash32;
  /** Read back from chain after the commit. Always equal to `policyHash`, or this call throws. */
  onchainPolicyHash: Hash32;
  gas: GasSummary;
}

export interface SettleClearedInput {
  verdict: Verdict;
  /** 6-decimal base units, bigint only (CLAUDE.md rule 2). */
  valueUsdc: bigint;
  /** Must come from `deriveVendorRecipient` — see the RECIPIENT RULE above. */
  recipient: DerivedRecipient;
}

export interface SettleWithStepUpInput extends SettleClearedInput {
  /** Must come from `approveStepUpForSettlement` (which runs the real `decideStepUp`). A hand-built object is refused. */
  stepUpDecision: CertifiedStepUpApproval;
}

export interface SettleOptions {
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Defaults to `Date.now()`. Used only for the step-up freshness re-check. */
  nowMs?: number;
}

function config(options?: SettleOptions): SettlementConfig {
  return loadSettlementConfig(options?.env ?? process.env);
}

/** CLEARED -> one PTB: `mint_verdict` (outcome 0) then `settle` into the shared `Vault<T>`. */
export async function settleCleared(input: SettleClearedInput, options?: SettleOptions): Promise<SettlementResult> {
  const { verdict, valueUsdc, recipient } = input;
  assertDerivedRecipient(recipient);
  assertU64Amount(valueUsdc);
  if (verdict.outcome !== OUTCOME_CLEARED) {
    throw new PtbArgumentError(`settleCleared needs a CLEARED verdict (outcome 0); got outcome ${verdict.outcome}.`);
  }
  const cfg = config(options);
  const out = await executePtb(cfg, buildSettleClearedArgs(cfg, verdict, valueUsdc, recipient));
  const confirmation = await confirmSettlement(cfg, out.digest, { recipient: recipient.address, valueUsdc, viaStepup: false });
  return {
    digest: out.digest,
    explorerUrl: explorerTxUrl(out.digest),
    vendorId: recipient.vendorId,
    recipient: recipient.address,
    valueUsdc,
    ...confirmation,
  };
}

/**
 * HELD_FOR_STEPUP + certified World approval -> one PTB: `mint_verdict`
 * (outcome 2), `mint_stepup_approval`, `settle_with_stepup`.
 *
 * Refuses, before any config load or CLI call, unless `stepUpDecision` is a
 * certified `{approved: true}` from `approveStepUpForSettlement`, is for
 * this verdict's proposal hash, and is still within World's freshness
 * window.
 */
export async function settleWithStepUp(input: SettleWithStepUpInput, options?: SettleOptions): Promise<SettlementResult> {
  const { verdict, valueUsdc, recipient, stepUpDecision } = input;
  assertStepUpAuthorized(verdict, stepUpDecision, options?.nowMs ?? Date.now());
  assertDerivedRecipient(recipient);
  assertU64Amount(valueUsdc);
  const cfg = config(options);
  const out = await executePtb(cfg, buildSettleWithStepUpArgs(cfg, verdict, valueUsdc, recipient));
  const confirmation = await confirmSettlement(cfg, out.digest, { recipient: recipient.address, valueUsdc, viaStepup: true });
  return {
    digest: out.digest,
    explorerUrl: explorerTxUrl(out.digest),
    vendorId: recipient.vendorId,
    recipient: recipient.address,
    valueUsdc,
    ...confirmation,
  };
}

/**
 * `bonded_registry::commit_policy(cap, registry, agent, policy_hash)`, then
 * read back through `readPolicyHash` to confirm the chain now holds exactly
 * `policyHash` for this agent.
 */
export async function commitPolicy(agentAddress: string, policyHash: Hash32, options?: SettleOptions): Promise<CommitPolicyResult> {
  const agentKey = registryAgentKey(agentAddress);
  hash32ToVecLiteral(policyHash, 'policyHash');
  const cfg = config(options);
  const out = await executePtb(cfg, buildCommitPolicyArgs(cfg, agentKey, policyHash));
  const onchain = await readPolicyHashWithConfig(agentKey, cfg);
  if (onchain === null || onchain.toLowerCase() !== policyHash.toLowerCase()) {
    throw new PtbArgumentError(
      `commit_policy tx ${out.digest} succeeded but the registry reads back ${onchain ?? 'nothing'} for ${agentKey}, not ${policyHash}.`,
    );
  }
  return {
    digest: out.digest,
    explorerUrl: explorerTxUrl(out.digest),
    agentKey,
    policyHash,
    onchainPolicyHash: onchain,
    gas: gasSummary(out.effects.gasUsed),
  };
}

/** `BondedRegistry.current_policy_hash[agent]`, read through gRPC simulate. `null` if never committed. */
export async function readPolicyHash(agentAddress: string, options?: SettleOptions): Promise<Hash32 | null> {
  return readPolicyHashWithConfig(agentAddress, config(options));
}

/**
 * `Vault<T>.spent_this_period`, read through gRPC simulate. A vault-wide,
 * never-reset running total of payouts (see chain.ts). The console uses it
 * as `enforce()`'s `sumRecentSpend`.
 */
export async function readVaultSpent(options?: SettleOptions): Promise<bigint> {
  return readVaultSpentWithConfig(config(options));
}
