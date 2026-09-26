import { describe, expect, it } from '@jest/globals';
import { loadSettlementConfig } from '../config.js';
import {
  assertU64Amount,
  buildCommitPolicyArgs,
  buildSettleClearedArgs,
  buildSettleWithStepUpArgs,
  hash32ToVecLiteral,
  PtbArgumentError,
  toDryRunArgs,
} from '../ptb.js';
import { deriveVendorRecipient } from '../recipient.js';
import { registryAgentKey } from '../chain.js';
import { CAP, clearedVerdict, COIN, heldVerdict, PKG, POLICY_HASH, REAL_ENV, REGISTRY, repeatedVec, VAULT } from './fixtures.js';

const cfg = loadSettlementConfig({ ...REAL_ENV });
const ACME_PAYOUT = '0x4d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e6b7885929facb9c6d3e0';

describe('hash32ToVecLiteral', () => {
  it('encodes each byte as a decimal element', () => {
    expect(hash32ToVecLiteral(`0x${'ff'.repeat(31)}00`, 'h')).toBe(`[${[...Array(31).fill(255), 0].join(',')}]`);
  });
  it('rejects a non-32-byte hash', () => {
    expect(() => hash32ToVecLiteral('0xdeadbeef', 'verdict.proposalHash')).toThrow(/verdict.proposalHash must be a 0x-prefixed 32-byte/);
  });
});

describe('assertU64Amount (CLAUDE.md rule 2: bigint only)', () => {
  it('accepts a positive bigint up to u64 max', () => {
    expect(() => assertU64Amount(1n)).not.toThrow();
    expect(() => assertU64Amount((1n << 64n) - 1n)).not.toThrow();
  });
  it('rejects zero, negatives, overflow, and a number', () => {
    expect(() => assertU64Amount(0n)).toThrow(PtbArgumentError);
    expect(() => assertU64Amount(-1n)).toThrow(PtbArgumentError);
    expect(() => assertU64Amount(1n << 64n)).toThrow(/exceeds u64/);
    // @ts-expect-error a number is never an amount
    expect(() => assertU64Amount(1250)).toThrow(/must be a bigint/);
  });
});

describe('buildSettleClearedArgs', () => {
  it('builds the exact mint_verdict(outcome 0) + settle PTB', async () => {
    const recipient = await deriveVendorRecipient('vnd-acme-supplies');
    expect(buildSettleClearedArgs(cfg, clearedVerdict(), 1_250_000_000n, recipient)).toEqual([
      'client', 'ptb',
      '--make-move-vec', '<u8>', repeatedVec(1), '--assign', 'proposal_hash',
      '--make-move-vec', '<u8>', repeatedVec(2), '--assign', 'policy_hash',
      '--move-call', `${PKG}::bonded_vault::mint_verdict`,
      `@${CAP}`, 'proposal_hash', 'policy_hash', '0u8', '0u16', '1250000000u64',
      '--assign', 'verdict',
      '--move-call', `${PKG}::bonded_vault::settle`, `<${COIN}>`,
      `@${VAULT}`, 'verdict', `@${ACME_PAYOUT}`,
      '--gas-budget', '50000000', '--json',
    ]);
  });

  it('refuses a verdict that is not CLEARED', async () => {
    const recipient = await deriveVendorRecipient('vnd-acme-supplies');
    expect(() => buildSettleClearedArgs(cfg, heldVerdict(), 1n, recipient)).toThrow(/needs a CLEARED verdict/);
    expect(() => buildSettleClearedArgs(cfg, { ...clearedVerdict(), outcome: 1 }, 1n, recipient)).toThrow(/needs a CLEARED verdict/);
  });
});

describe('buildSettleWithStepUpArgs', () => {
  it('builds the exact mint_verdict(outcome 2) + mint_stepup_approval + settle_with_stepup PTB', async () => {
    const recipient = await deriveVendorRecipient('vnd-globex-freight');
    expect(buildSettleWithStepUpArgs(cfg, heldVerdict(), 8_450_000_000n, recipient)).toEqual([
      'client', 'ptb',
      '--make-move-vec', '<u8>', repeatedVec(1), '--assign', 'proposal_hash',
      '--make-move-vec', '<u8>', repeatedVec(2), '--assign', 'policy_hash',
      '--make-move-vec', '<u8>', repeatedVec(1), '--assign', 'approval_proposal_hash',
      '--move-call', `${PKG}::bonded_vault::mint_verdict`,
      `@${CAP}`, 'proposal_hash', 'policy_hash', '2u8', '7u16', '8450000000u64',
      '--assign', 'verdict',
      '--move-call', `${PKG}::bonded_vault::mint_stepup_approval`, `@${CAP}`, 'approval_proposal_hash',
      '--assign', 'approval',
      '--move-call', `${PKG}::bonded_vault::settle_with_stepup`, `<${COIN}>`,
      `@${VAULT}`, 'verdict', 'approval', '@0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e',
      '--gas-budget', '50000000', '--json',
    ]);
  });

  it('refuses a verdict that is not HELD_FOR_STEPUP', async () => {
    const recipient = await deriveVendorRecipient('vnd-globex-freight');
    expect(() => buildSettleWithStepUpArgs(cfg, clearedVerdict(), 1n, recipient)).toThrow(/needs a HELD_FOR_STEPUP verdict/);
  });
});

describe('buildCommitPolicyArgs', () => {
  it('builds the exact commit_policy PTB against the padded 32-byte agent key', () => {
    const agent = registryAgentKey(`0x${'aa'.repeat(20)}`);
    expect(agent).toBe(`0x${'00'.repeat(12)}${'aa'.repeat(20)}`);
    expect(buildCommitPolicyArgs(cfg, agent, POLICY_HASH)).toEqual([
      'client', 'ptb',
      '--make-move-vec', '<u8>', repeatedVec(2), '--assign', 'policy_hash',
      '--move-call', `${PKG}::bonded_registry::commit_policy`,
      `@${CAP}`, `@${REGISTRY}`, `@${agent}`, 'policy_hash',
      '--gas-budget', '50000000', '--json',
    ]);
  });

  it('refuses an un-normalized agent address', () => {
    expect(() => buildCommitPolicyArgs(cfg, `0x${'aa'.repeat(20)}`, POLICY_HASH)).toThrow(/normalized 32-byte Sui address/);
  });
});

describe('toDryRunArgs', () => {
  it('drops --json, keeps the gas budget, appends --dry-run', () => {
    expect(toDryRunArgs(['client', 'ptb', '--move-call', 'x', '--gas-budget', '5', '--json'])).toEqual([
      'client', 'ptb', '--move-call', 'x', '--gas-budget', '5', '--dry-run',
    ]);
  });
});

describe('registryAgentKey', () => {
  it('keeps a full 32-byte address and lower-cases it', () => {
    expect(registryAgentKey(`0x${'AB'.repeat(32)}`)).toBe(`0x${'ab'.repeat(32)}`);
  });
  it('rejects a non-hex or over-long address', () => {
    expect(() => registryAgentKey('0xzz')).toThrow();
    expect(() => registryAgentKey(`0x${'aa'.repeat(33)}`)).toThrow();
  });
});
