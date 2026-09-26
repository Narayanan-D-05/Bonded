import { describe, expect, it } from '@jest/globals';
import { loadSettlementConfig, SettlementConfigError, SETTLEMENT_ENV } from '../config.js';
import { settleCleared, commitPolicy } from '../settle.js';
import { deriveVendorRecipient } from '../recipient.js';
import { clearedVerdict, POLICY_HASH, REAL_ENV } from './fixtures.js';

describe('loadSettlementConfig', () => {
  it('accepts the real public testnet ids', () => {
    const cfg = loadSettlementConfig({ ...REAL_ENV });
    expect(cfg.packageId).toBe(REAL_ENV.SUI_BONDED_PACKAGE_ID);
    expect(cfg.coinType).toBe(REAL_ENV.SUI_BOND_COIN_TYPE);
    expect(cfg.network).toBe('testnet');
    expect(cfg.gasBudgetMist).toBe(50_000_000n);
  });

  it.each(Object.values(SETTLEMENT_ENV))('fails visibly and names %s when it is missing', (name) => {
    const env: Record<string, string | undefined> = { ...REAL_ENV };
    delete env[name];
    expect(() => loadSettlementConfig(env)).toThrow(SettlementConfigError);
    expect(() => loadSettlementConfig(env)).toThrow(new RegExp(`^${name} is not set`));
  });

  it.each(Object.values(SETTLEMENT_ENV))('treats a blank %s as missing', (name) => {
    expect(() => loadSettlementConfig({ ...REAL_ENV, [name]: '   ' })).toThrow(new RegExp(`^${name} is not set`));
  });

  it('rejects a short object id and names the variable', () => {
    expect(() => loadSettlementConfig({ ...REAL_ENV, SUI_VAULT_ID: '0x1c82' })).toThrow(/SUI_VAULT_ID must be a full 0x-prefixed 32-byte object id/);
  });

  it('rejects an unqualified coin type (the two-USDSUI trap)', () => {
    expect(() => loadSettlementConfig({ ...REAL_ENV, SUI_BOND_COIN_TYPE: 'usdsui::USDSUI' })).toThrow(/SUI_BOND_COIN_TYPE must be a fully qualified coin type/);
  });

  it('refuses any network other than testnet', () => {
    expect(() => loadSettlementConfig({ ...REAL_ENV, SUI_NETWORK: 'mainnet' })).toThrow(/only ever submits to testnet/);
  });

  it('rejects a non-integer gas budget', () => {
    expect(() => loadSettlementConfig({ ...REAL_ENV, SUI_SETTLEMENT_GAS_BUDGET_MIST: '0.05' })).toThrow(/base-10 integer/);
  });

  it('settleCleared fails on missing config before any CLI call, naming the variable', async () => {
    const recipient = await deriveVendorRecipient('vnd-acme-supplies');
    await expect(settleCleared({ verdict: clearedVerdict(), valueUsdc: 1_250_000_000n, recipient }, { env: {} })).rejects.toThrow(
      /^SUI_BONDED_PACKAGE_ID is not set/,
    );
  });

  it('commitPolicy fails on missing config before any CLI call, naming the variable', async () => {
    const env: Record<string, string | undefined> = { ...REAL_ENV };
    delete env.SUI_ENFORCER_CAP_ID;
    await expect(commitPolicy(`0x${'aa'.repeat(20)}`, POLICY_HASH, { env })).rejects.toThrow(/^SUI_ENFORCER_CAP_ID is not set/);
  });
});
