/**
 * Pure builders for `sui client ptb` argument arrays. No I/O.
 *
 * Every array here is passed straight to `execFile` (see `cli.ts`), one
 * element per argv slot, never through a shell. So nothing gets quoted or
 * escaped, and no value can be interpreted as shell syntax.
 *
 * Incantation notes, from what already worked live (FEEDBACK/sui.md,
 * 2026-09-26):
 *   - `vector<u8>` arguments are built with `--make-move-vec <u8> [..]` and
 *     bound with `--assign <name>`. Inline bracket literals inside
 *     `--move-call` are rejected by the CLI's PTB parser.
 *   - `mint_verdict` returns a bare `Verdict` with no `drop`, so it must be
 *     `--assign`ed and consumed by `settle`/`settle_with_stepup` in the same
 *     PTB. Otherwise the CLI fails with `UnusedValueWithoutDrop`.
 *   - Object ids take an `@` prefix. Numeric args carry explicit type
 *     suffixes (`0u8`, `7u16`, `1250000000u64`), so the parser never has to
 *     infer a width.
 */

import type { Hash32, Verdict } from '@bonded/seam';
import type { SettlementConfig } from './config.js';
import { assertDerivedRecipient, type DerivedRecipient } from './recipient.js';

export const OUTCOME_CLEARED = 0;
export const OUTCOME_HELD_FOR_STEPUP = 2;

const U64_MAX = (1n << 64n) - 1n;
const U16_MAX = 0xffff;

export class PtbArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PtbArgumentError';
  }
}

/** `0x`-prefixed 32-byte hex -> the CLI's `[b0,b1,...]` vector literal. */
export function hash32ToVecLiteral(hash: Hash32, label: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new PtbArgumentError(`${label} must be a 0x-prefixed 32-byte hex hash; got "${hash}".`);
  }
  const bytes: number[] = [];
  for (let i = 2; i < hash.length; i += 2) {
    bytes.push(parseInt(hash.slice(i, i + 2), 16));
  }
  return `[${bytes.join(',')}]`;
}

/** u64 amount check. `valueUsdc` is a bigint in 6-decimal base units (CLAUDE.md rule 2). Never a number. */
export function assertU64Amount(valueUsdc: bigint): void {
  if (typeof valueUsdc !== 'bigint') {
    throw new PtbArgumentError(`valueUsdc must be a bigint in 6-decimal base units; got ${typeof valueUsdc}.`);
  }
  if (valueUsdc <= 0n) {
    throw new PtbArgumentError(`valueUsdc must be positive; got ${valueUsdc}.`);
  }
  if (valueUsdc > U64_MAX) {
    throw new PtbArgumentError(`valueUsdc ${valueUsdc} exceeds u64.`);
  }
}

function reasonCodeU16(verdict: Verdict): string {
  const code = verdict.reasonCode as number;
  if (!Number.isInteger(code) || code < 0 || code > U16_MAX) {
    throw new PtbArgumentError(`reasonCode ${code} is not a u16.`);
  }
  return `${code}u16`;
}

function tail(config: SettlementConfig): string[] {
  return ['--gas-budget', config.gasBudgetMist.toString(), '--json'];
}

function hashVecs(verdict: Verdict): string[] {
  return [
    '--make-move-vec', '<u8>', hash32ToVecLiteral(verdict.proposalHash, 'verdict.proposalHash'),
    '--assign', 'proposal_hash',
    '--make-move-vec', '<u8>', hash32ToVecLiteral(verdict.policyHash, 'verdict.policyHash'),
    '--assign', 'policy_hash',
  ];
}

/**
 * CLEARED: one PTB, `mint_verdict(cap, proposal_hash, policy_hash, 0, reason, value)`
 * followed by `settle<T>(vault, verdict, recipient)`.
 */
export function buildSettleClearedArgs(
  config: SettlementConfig,
  verdict: Verdict,
  valueUsdc: bigint,
  recipient: DerivedRecipient,
): string[] {
  assertDerivedRecipient(recipient);
  assertU64Amount(valueUsdc);
  if (verdict.outcome !== OUTCOME_CLEARED) {
    throw new PtbArgumentError(`settleCleared needs a CLEARED verdict (outcome 0); got outcome ${verdict.outcome}.`);
  }
  const pkg = config.packageId;
  return [
    'client', 'ptb',
    ...hashVecs(verdict),
    '--move-call', `${pkg}::bonded_vault::mint_verdict`,
    `@${config.enforcerCapId}`, 'proposal_hash', 'policy_hash', `${OUTCOME_CLEARED}u8`, reasonCodeU16(verdict), `${valueUsdc}u64`,
    '--assign', 'verdict',
    '--move-call', `${pkg}::bonded_vault::settle`, `<${config.coinType}>`,
    `@${config.vaultId}`, 'verdict', `@${recipient.address}`,
    ...tail(config),
  ];
}

/**
 * HELD_FOR_STEPUP + certified World approval: one PTB,
 * `mint_verdict(.., 2, ..)`, `mint_stepup_approval(cap, proposal_hash)`,
 * then `settle_with_stepup<T>(vault, verdict, approval, recipient)`.
 *
 * The approval's `proposal_hash` is built from its own `--make-move-vec`
 * so the Move-side `EProposalHashMismatch` check compares two independently
 * supplied byte vectors.
 *
 * This builder assumes the caller has already run `assertStepUpAuthorized`.
 * `settleWithStepUp` is the only caller, and it does that first.
 */
export function buildSettleWithStepUpArgs(
  config: SettlementConfig,
  verdict: Verdict,
  valueUsdc: bigint,
  recipient: DerivedRecipient,
): string[] {
  assertDerivedRecipient(recipient);
  assertU64Amount(valueUsdc);
  if (verdict.outcome !== OUTCOME_HELD_FOR_STEPUP) {
    throw new PtbArgumentError(`settleWithStepUp needs a HELD_FOR_STEPUP verdict (outcome 2); got outcome ${verdict.outcome}.`);
  }
  const pkg = config.packageId;
  return [
    'client', 'ptb',
    ...hashVecs(verdict),
    '--make-move-vec', '<u8>', hash32ToVecLiteral(verdict.proposalHash, 'verdict.proposalHash'),
    '--assign', 'approval_proposal_hash',
    '--move-call', `${pkg}::bonded_vault::mint_verdict`,
    `@${config.enforcerCapId}`, 'proposal_hash', 'policy_hash', `${OUTCOME_HELD_FOR_STEPUP}u8`, reasonCodeU16(verdict), `${valueUsdc}u64`,
    '--assign', 'verdict',
    '--move-call', `${pkg}::bonded_vault::mint_stepup_approval`,
    `@${config.enforcerCapId}`, 'approval_proposal_hash',
    '--assign', 'approval',
    '--move-call', `${pkg}::bonded_vault::settle_with_stepup`, `<${config.coinType}>`,
    `@${config.vaultId}`, 'verdict', 'approval', `@${recipient.address}`,
    ...tail(config),
  ];
}

/** `commit_policy(cap, registry, agent, policy_hash)`. `agent` must already be a normalized 32-byte Sui address. */
export function buildCommitPolicyArgs(config: SettlementConfig, agent: string, policyHash: Hash32): string[] {
  if (!/^0x[0-9a-f]{64}$/.test(agent)) {
    throw new PtbArgumentError(`agent must be a normalized 32-byte Sui address; got "${agent}".`);
  }
  return [
    'client', 'ptb',
    '--make-move-vec', '<u8>', hash32ToVecLiteral(policyHash, 'policyHash'),
    '--assign', 'policy_hash',
    '--move-call', `${config.packageId}::bonded_registry::commit_policy`,
    `@${config.enforcerCapId}`, `@${config.registryId}`, `@${agent}`, 'policy_hash',
    ...tail(config),
  ];
}

/**
 * The same PTB with `--json` dropped and `--dry-run` appended (the gas budget is kept). Used as a
 * free pre-flight, so an abort (wrong outcome, empty vault, missing cap) never
 * burns gas on a failed on-chain transaction.
 */
export function toDryRunArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--gas-budget') {
      out.push(a, args[i + 1]!);
      i++;
      continue;
    }
    if (a === '--json') continue;
    out.push(a);
  }
  out.push('--dry-run');
  return out;
}
