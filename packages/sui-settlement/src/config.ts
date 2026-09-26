/**
 * Settlement config: PUBLIC on-chain object ids only.
 *
 * CLAUDE.md rule 3: nothing here signs, and nothing here is a secret. Signing
 * happens inside the Sui CLI's own keystore (`sui client ptb`, see `cli.ts`),
 * which this package never opens, reads, or prints. The five required vars
 * are the deployed package / shared-object / capability ids recorded in
 * `move/DEPLOYMENTS.md`, and they're committed with their real values in the
 * root `.env.example`.
 *
 * A missing or malformed var fails visibly and names the variable. There's
 * no default id baked in here, so a misconfigured process can't quietly
 * settle against the wrong vault.
 */

export const SETTLEMENT_ENV = {
  packageId: 'SUI_BONDED_PACKAGE_ID',
  vaultId: 'SUI_VAULT_ID',
  registryId: 'SUI_REGISTRY_ID',
  enforcerCapId: 'SUI_ENFORCER_CAP_ID',
  coinType: 'SUI_BOND_COIN_TYPE',
} as const;

/** Optional, non-secret knobs. */
export const OPTIONAL_ENV = {
  /** Must be `testnet` if set. This package refuses every other network. */
  network: 'SUI_NETWORK',
  /** gRPC base URL for read-back. Defaults to the public testnet fullnode. */
  rpcUrl: 'SUI_RPC_URL',
  /** Path to the `sui` binary, if it isn't on PATH. */
  suiBin: 'SUI_BIN',
  /** Per-transaction gas budget cap in MIST. Defaults to 50,000,000 (0.05 SUI). */
  gasBudgetMist: 'SUI_SETTLEMENT_GAS_BUDGET_MIST',
} as const;

export const DEFAULT_TESTNET_RPC_URL = 'https://fullnode.testnet.sui.io:443';
export const DEFAULT_GAS_BUDGET_MIST = 50_000_000n;

export interface SettlementConfig {
  packageId: string;
  vaultId: string;
  registryId: string;
  enforcerCapId: string;
  /** Fully qualified `0x<64 hex>::module::Name`. */
  coinType: string;
  network: 'testnet';
  rpcUrl: string;
  suiBin: string;
  gasBudgetMist: bigint;
}

export class SettlementConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementConfigError';
  }
}

const OBJECT_ID = /^0x[0-9a-fA-F]{64}$/;
const COIN_TYPE = /^0x[0-9a-fA-F]{64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/;

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new SettlementConfigError(
      `${name} is not set. @bonded/sui-settlement needs it to build a real settlement transaction; ` +
        `the public testnet value is recorded in move/DEPLOYMENTS.md and the root .env.example.`,
    );
  }
  return raw.trim();
}

function objectId(env: Env, name: string): string {
  const value = required(env, name);
  if (!OBJECT_ID.test(value)) {
    throw new SettlementConfigError(`${name} must be a full 0x-prefixed 32-byte object id (0x + 64 hex chars); got "${value}".`);
  }
  return value.toLowerCase();
}

/**
 * Reads and validates the settlement config. Every required var is checked
 * before any network or CLI call is made, and the first missing one is named
 * in the thrown error.
 */
export function loadSettlementConfig(env: Env = process.env): SettlementConfig {
  const packageId = objectId(env, SETTLEMENT_ENV.packageId);
  const vaultId = objectId(env, SETTLEMENT_ENV.vaultId);
  const registryId = objectId(env, SETTLEMENT_ENV.registryId);
  const enforcerCapId = objectId(env, SETTLEMENT_ENV.enforcerCapId);
  const coinType = required(env, SETTLEMENT_ENV.coinType);
  if (!COIN_TYPE.test(coinType)) {
    throw new SettlementConfigError(
      `${SETTLEMENT_ENV.coinType} must be a fully qualified coin type (0x<64 hex>::module::Name); got "${coinType}". ` +
        `The package address is the only reliable discriminator — this wallet holds two unrelated coins both named usdsui::USDSUI (see FEEDBACK/sui.md).`,
    );
  }

  const network = env[OPTIONAL_ENV.network]?.trim() || 'testnet';
  if (network !== 'testnet') {
    throw new SettlementConfigError(`${OPTIONAL_ENV.network} is "${network}". @bonded/sui-settlement only ever submits to testnet.`);
  }

  const budgetRaw = env[OPTIONAL_ENV.gasBudgetMist]?.trim();
  let gasBudgetMist = DEFAULT_GAS_BUDGET_MIST;
  if (budgetRaw !== undefined && budgetRaw !== '') {
    if (!/^[0-9]+$/.test(budgetRaw)) {
      throw new SettlementConfigError(`${OPTIONAL_ENV.gasBudgetMist} must be a base-10 integer number of MIST; got "${budgetRaw}".`);
    }
    gasBudgetMist = BigInt(budgetRaw);
  }

  return {
    packageId,
    vaultId,
    registryId,
    enforcerCapId,
    coinType,
    network: 'testnet',
    rpcUrl: env[OPTIONAL_ENV.rpcUrl]?.trim() || DEFAULT_TESTNET_RPC_URL,
    suiBin: env[OPTIONAL_ENV.suiBin]?.trim() || 'sui',
    gasBudgetMist,
  };
}
