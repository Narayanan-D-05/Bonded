/**
 * Read-only chain access over gRPC (`@mysten/sui` 2.33.1's `SuiGrpcClient`).
 * Every API used here was checked against the installed type declarations
 * under node_modules/@mysten/sui/dist (grpc/client.d.mts,
 * client/types.d.mts), not taken from memory. The public fullnode no longer
 * serves JSON-RPC (FEEDBACK/sui.md, 2026-09-25), so JSON-RPC isn't used.
 *
 * Nothing in this file signs or submits. It confirms what the CLI submitted,
 * and reads the registry through `simulateTransaction`, which is the SDK's
 * dev-inspect path.
 */

import { bcs } from '@mysten/sui/bcs';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import type { Hash32 } from '@bonded/seam';
import type { SettlementConfig } from './config.js';

export function explorerTxUrl(digest: string): string {
  return `https://suiscan.xyz/testnet/tx/${digest}`;
}

export function grpcClient(config: SettlementConfig): SuiGrpcClient {
  return new SuiGrpcClient({ network: 'testnet', baseUrl: config.rpcUrl });
}

export class SettlementConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementConfirmationError';
  }
}

/** BCS layout of `bonded::bonded_vault::Settled` (field order from bonded_vault.move). `ID` is a 32-byte address. */
const SettledBcs = bcs.struct('Settled', {
  vault_id: bcs.Address,
  recipient: bcs.Address,
  value_usdc: bcs.u64(),
  spent_this_period: bcs.u64(),
  via_stepup: bcs.bool(),
});

/** BCS layout of `0x2::coin::Coin<T>`: `{ id: UID, balance: Balance<T> }`, where both wrappers are single-field structs. */
const CoinBcs = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() });

export interface SettledEvent {
  vaultId: string;
  recipient: string;
  valueUsdc: bigint;
  spentThisPeriod: bigint;
  viaStepup: boolean;
}

export interface GasSummary {
  computationCost: bigint;
  storageCost: bigint;
  storageRebate: bigint;
  /** computation + storage − rebate. What the sender actually paid, in MIST. */
  netMist: bigint;
}

export interface SettlementConfirmation {
  settled: SettledEvent;
  /** `balanceChanges` entry for (recipient, coinType), as reported by the fullnode. */
  recipientBalanceDelta: bigint;
  /** The Coin<T> object created for the recipient by this transaction. */
  payoutCoinId: string;
  /** That coin object's balance, read back and BCS-decoded. */
  payoutCoinBalance: bigint;
  gas: GasSummary;
}

export function gasSummary(g: { computationCost: string; storageCost: string; storageRebate: string }): GasSummary {
  const computationCost = BigInt(g.computationCost);
  const storageCost = BigInt(g.storageCost);
  const storageRebate = BigInt(g.storageRebate);
  return { computationCost, storageCost, storageRebate, netMist: computationCost + storageCost - storageRebate };
}

/**
 * Reads transaction `digest` back from the fullnode and checks, all of
 * them, that:
 *   - it succeeded,
 *   - it emitted exactly one `bonded_vault::Settled` event, for this vault,
 *     this recipient, this exact `valueUsdc`, and the expected `via_stepup`,
 *   - the fullnode's `balanceChanges` credit the recipient with exactly
 *     `valueUsdc` of the configured coin type,
 *   - it created exactly one `Coin<T>` owned by the recipient, and that coin
 *     object's own on-chain balance is exactly `valueUsdc`.
 * Any mismatch throws `SettlementConfirmationError` naming the digest.
 */
export async function confirmSettlement(
  config: SettlementConfig,
  digest: string,
  expected: { recipient: string; valueUsdc: bigint; viaStepup: boolean },
): Promise<SettlementConfirmation> {
  const client = grpcClient(config);
  const res = await client.waitForTransaction({
    digest,
    include: { events: true, balanceChanges: true, effects: true, objectTypes: true },
  });
  const fail = (msg: string): never => {
    throw new SettlementConfirmationError(`Tx ${digest} (${explorerTxUrl(digest)}): ${msg}`);
  };
  if (res.$kind !== 'Transaction') {
    return fail('the fullnode reports it as a failed transaction.');
  }
  const tx = res.Transaction;
  if (!tx.status.success) {
    return fail(`execution status is failure: ${JSON.stringify(tx.status.error)}`);
  }

  const recipient = normalizeSuiAddress(expected.recipient);
  const coinType = normalizeStructTag(config.coinType);
  const settledType = normalizeStructTag(`${config.packageId}::bonded_vault::Settled`);

  const settledEvents = tx.events.filter((e) => normalizeStructTag(e.eventType) === settledType);
  if (settledEvents.length !== 1) {
    return fail(`expected exactly one ${settledType} event, found ${settledEvents.length}.`);
  }
  const raw = SettledBcs.parse(settledEvents[0]!.bcs);
  const settled: SettledEvent = {
    vaultId: normalizeSuiAddress(raw.vault_id),
    recipient: normalizeSuiAddress(raw.recipient),
    valueUsdc: BigInt(raw.value_usdc),
    spentThisPeriod: BigInt(raw.spent_this_period),
    viaStepup: raw.via_stepup,
  };
  if (settled.vaultId !== normalizeSuiAddress(config.vaultId)) fail(`Settled.vault_id ${settled.vaultId} is not the configured vault.`);
  if (settled.recipient !== recipient) fail(`Settled.recipient ${settled.recipient} is not the derived recipient ${recipient}.`);
  if (settled.valueUsdc !== expected.valueUsdc) fail(`Settled.value_usdc ${settled.valueUsdc} != expected ${expected.valueUsdc}.`);
  if (settled.viaStepup !== expected.viaStepup) fail(`Settled.via_stepup is ${settled.viaStepup}, expected ${expected.viaStepup}.`);

  const credit = tx.balanceChanges.filter(
    (b) => normalizeSuiAddress(b.address) === recipient && normalizeStructTag(b.coinType) === coinType,
  );
  if (credit.length !== 1) fail(`expected one balance change for the recipient in ${coinType}, found ${credit.length}.`);
  const recipientBalanceDelta = BigInt(credit[0]!.amount);
  if (recipientBalanceDelta !== expected.valueUsdc) {
    fail(`recipient balance changed by ${recipientBalanceDelta}, expected exactly ${expected.valueUsdc}.`);
  }

  const coinObjType = normalizeStructTag(`0x2::coin::Coin<${coinType}>`);
  const created = tx.effects.changedObjects.filter(
    (o) =>
      o.idOperation === 'Created' &&
      o.outputOwner?.$kind === 'AddressOwner' &&
      normalizeSuiAddress(o.outputOwner.AddressOwner) === recipient &&
      tx.objectTypes[o.objectId] !== undefined &&
      normalizeStructTag(tx.objectTypes[o.objectId]!) === coinObjType,
  );
  if (created.length !== 1) fail(`expected one new ${coinObjType} owned by the recipient, found ${created.length}.`);
  const payoutCoinId = created[0]!.objectId;
  const { object } = await client.getObject({ objectId: payoutCoinId, include: { content: true } });
  const payoutCoinBalance = BigInt(CoinBcs.parse(object.content).balance);
  if (payoutCoinBalance !== expected.valueUsdc) {
    fail(`payout coin ${payoutCoinId} holds ${payoutCoinBalance}, expected exactly ${expected.valueUsdc}.`);
  }

  return { settled, recipientBalanceDelta, payoutCoinId, payoutCoinBalance, gas: gasSummary(tx.effects.gasUsed) };
}

/**
 * Normalizes an agent address to the 32-byte form the registry's
 * `Table<address, vector<u8>>` is keyed by. A shorter address (e.g. the demo
 * agent's 20-byte `0xaaaa…aa`) is left-padded with zeros. That's what the
 * Move `address` type and the Sui CLI's `@0x…` literal both do, so commit
 * and read agree on the key.
 */
export function registryAgentKey(agentAddress: string): string {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(agentAddress)) {
    throw new SettlementConfirmationError(`agentAddress "${agentAddress}" is not a hex address of at most 32 bytes.`);
  }
  return normalizeSuiAddress(agentAddress.toLowerCase());
}

async function simulateRegistryCall(config: SettlementConfig, fn: 'has_policy_hash' | 'current_policy_hash', agent: string) {
  const client = grpcClient(config);
  const tx = new Transaction();
  tx.setSender(agent);
  tx.moveCall({
    target: `${config.packageId}::bonded_registry::${fn}`,
    arguments: [tx.object(config.registryId), tx.pure.address(agent)],
  });
  const sim = await client.simulateTransaction({ transaction: tx, include: { commandResults: true } });
  if (sim.$kind !== 'Transaction') {
    throw new SettlementConfirmationError(
      `simulate ${fn} failed: ${JSON.stringify(sim.FailedTransaction.status.error)}`,
    );
  }
  const out = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (out === undefined) {
    throw new SettlementConfirmationError(`simulate ${fn} returned no return value.`);
  }
  return out;
}

/**
 * Reads `BondedRegistry.current_policy_hash[agent]` from chain, through a
 * simulated (never executed, never signed) call to the Move getters.
 * Returns `null` if the agent has never had a policy committed. This is the
 * real `onchainPolicyHash` for `enforce()`, rather than a hash recomputed
 * locally.
 */
export async function readPolicyHash(agentAddress: string, config: SettlementConfig): Promise<Hash32 | null> {
  const agent = registryAgentKey(agentAddress);
  const has = bcs.bool().parse(await simulateRegistryCall(config, 'has_policy_hash', agent));
  if (!has) return null;
  const bytes = bcs.byteVector().parse(await simulateRegistryCall(config, 'current_policy_hash', agent));
  return `0x${Buffer.from(bytes).toString('hex')}` as Hash32;
}

/**
 * Reads `Vault<T>.spent_this_period` from chain, through a simulated (never
 * executed, never signed) call to the Move getter
 * `bonded_vault::spent_this_period<T>(vault: &Vault<T>): u64`.
 *
 * What the number is, stated plainly (read from bonded_vault.move, not
 * assumed): a vault-wide running total of every `settle`/`settle_with_stepup`
 * payout. It is not per agent, and nothing in the Move module ever resets
 * it, so "this period" is in practice "since the vault was created".
 */
export async function readVaultSpentThisPeriod(config: SettlementConfig): Promise<bigint> {
  const client = grpcClient(config);
  const tx = new Transaction();
  tx.setSender(normalizeSuiAddress(config.vaultId));
  tx.moveCall({
    target: `${config.packageId}::bonded_vault::spent_this_period`,
    typeArguments: [config.coinType],
    arguments: [tx.object(config.vaultId)],
  });
  const sim = await client.simulateTransaction({ transaction: tx, include: { commandResults: true } });
  if (sim.$kind !== 'Transaction') {
    throw new SettlementConfirmationError(`simulate spent_this_period failed: ${JSON.stringify(sim.FailedTransaction.status.error)}`);
  }
  const out = sim.commandResults?.[0]?.returnValues?.[0]?.bcs;
  if (out === undefined) {
    throw new SettlementConfirmationError('simulate spent_this_period returned no return value.');
  }
  return BigInt(bcs.u64().parse(out));
}
