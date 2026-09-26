/**
 * Live testnet run (testnet only, never mainnet). No mocks:
 *
 *   1. Commit the acme demo policy's canonicalHash to the shared BondedRegistry
 *      for the demo agent (skipped if the registry already holds that exact hash).
 *   2. Read it back from chain, and pass THAT on-chain value into the real
 *      enforce() as `onchainPolicyHash`.
 *   3. enforce() -> CLEARED for vnd-acme-supplies, then settleCleared() pays the
 *      vendor-master payout address (re-derived, not the invoice's claim) and
 *      reads the transaction back.
 *   4. Print before/after balances and exact deltas.
 *
 * settleWithStepUp is deliberately NOT run here: a real StepUpApproval requires a
 * real World ID verification, and the World sandbox credentials don't exist yet.
 *
 * The acme scenario below mirrors apps/console/lib/enforce-deps.ts's
 * `vnd-acme-supplies` case field-for-field (itself mirrored from
 * villain-corpus's buildScenario3). It's copied, not imported, because
 * neither package exports it.
 *
 * Run: pnpm --filter @bonded/sui-settlement live:testnet   (with the SUI_* ids in env)
 */

import type { Address, Hash32, PolicyArtifact, Proposal } from '@bonded/seam';
import { enforce } from '@bonded/enforcer';
import { canonicalHash, createEnforceDeps } from '@bonded/dispatcher';
import { fetchVendorTruth, issuerOracleVendors } from '@bonded/issuer-oracle';
import { commitPolicy, deriveVendorRecipient, loadSettlementConfig, readPolicyHash, settleCleared } from '../src/index.js';
import { grpcClient } from '../src/chain.js';

/** Total spend cap for this task, in MIST (0.3 SUI), minus what the earlier mint+fund tx already spent. */
const TASK_CAP_MIST = 300_000_000n;
const ALREADY_SPENT_MIST = BigInt(process.env.LIVE_ALREADY_SPENT_MIST ?? '0');

const NAIVE_AP_AGENT_ADDRESS = `0x${'aa'.repeat(20)}` as Address;
const AP_VAULT_TARGET_ADDRESS = `0x${'bb'.repeat(20)}` as Address;
const SENDER = '0x916c7accd3308e4a8ec896b51b2a0bbcd510abff0579c059455b7e30d147f05a';

async function acmeScenario(): Promise<{ policy: PolicyArtifact; proposal: Proposal }> {
  const vendorId = 'vnd-acme-supplies';
  const truth = await fetchVendorTruth(vendorId);
  if (truth === null) throw new Error('acme missing from issuer-oracle fixture');
  const policy: PolicyArtifact = {
    version: 1,
    budget: { asset: 'USDC', period: 'daily', max: '100000000000' },
    premises: [
      { id: 'p-vendor-payout', schema: 'issuer-oracle-vendors', field: 'vendor.payoutAddress', op: 'eq', value: truth.payoutAddress, args: [vendorId] },
      { id: 'p-vendor-status', schema: 'issuer-oracle-vendors', field: 'vendor.status', op: 'eq', value: 'active', args: [vendorId] },
    ],
    forbid: [],
    irreversibleAboveUSDC: '50000000000',
  };
  const proposal: Proposal = {
    id: `0x${'33'.repeat(32)}` as Hash32,
    agent: NAIVE_AP_AGENT_ADDRESS,
    action: { kind: 'transfer', target: AP_VAULT_TARGET_ADDRESS, calldata: '0x', valueUSDC: truth.invoiceAmountUSD },
    premises: [
      { premiseId: 'p-vendor-payout', claimedValue: truth.payoutAddress },
      { premiseId: 'p-vendor-status', claimedValue: truth.status },
    ],
    createdAt: 1_790_200_200,
  };
  return { policy, proposal };
}

async function main(): Promise<void> {
  const cfg = loadSettlementConfig();
  const client = grpcClient(cfg);
  let spent = ALREADY_SPENT_MIST;
  const guard = (label: string) => {
    if (spent + cfg.gasBudgetMist > TASK_CAP_MIST) {
      throw new Error(`STOP before ${label}: spent ${spent} MIST + budget ${cfg.gasBudgetMist} would exceed the ${TASK_CAP_MIST} MIST cap.`);
    }
  };
  const suiBal = async () => BigInt((await client.getBalance({ owner: SENDER })).balance.balance);
  const suiStart = await suiBal();

  const { policy, proposal } = await acmeScenario();
  const policyHash = canonicalHash(policy);
  console.log('acme demo policy canonicalHash:', policyHash);

  // 1. commit (idempotent)
  const before = await readPolicyHash(NAIVE_AP_AGENT_ADDRESS);
  console.log('registry before:', before);
  if (before?.toLowerCase() === policyHash.toLowerCase()) {
    console.log('registry already holds this hash; commit skipped.');
  } else {
    guard('commitPolicy');
    const c = await commitPolicy(NAIVE_AP_AGENT_ADDRESS, policyHash);
    spent += c.gas.netMist;
    console.log('commitPolicy:', { digest: c.digest, explorer: c.explorerUrl, agentKey: c.agentKey, onchain: c.onchainPolicyHash, gasNetMist: c.gas.netMist.toString() });
  }

  // 2. the on-chain value feeds enforce()
  const onchainPolicyHash = await readPolicyHash(NAIVE_AP_AGENT_ADDRESS);
  if (onchainPolicyHash === null) throw new Error('registry has no policy hash after commit');
  const deps = createEnforceDeps(
    { 'issuer-oracle-vendors': issuerOracleVendors },
    { getCheckpoint: async () => BigInt(Math.floor(Date.now() / 1000)), sumRecentSpend: async () => 0n, logMismatch: async () => {} },
  );
  const verdict = await enforce(proposal, policy, onchainPolicyHash, deps);
  console.log('enforce() verdict:', { outcome: verdict.outcome, reasonCode: verdict.reasonCode, proposalHash: verdict.proposalHash, policyHash: verdict.policyHash });
  if (verdict.outcome !== 0) throw new Error(`expected CLEARED, got outcome ${verdict.outcome}`);

  // 3. settle, paying the vendor-master address
  const recipient = await deriveVendorRecipient('vnd-acme-supplies');
  const valueUsdc = BigInt(proposal.action.valueUSDC);
  const coinBal = async (owner: string) => BigInt((await client.getBalance({ owner, coinType: cfg.coinType })).balance.balance);
  const vaultBal = async () => {
    const { object } = await client.getObject({ objectId: cfg.vaultId, include: { json: true } });
    return object.json;
  };
  const recipBefore = await coinBal(recipient.address);
  const vaultBefore = await vaultBal();
  guard('settleCleared');
  const s = await settleCleared({ verdict, valueUsdc, recipient });
  spent += s.gas.netMist;
  const recipAfter = await coinBal(recipient.address);
  const vaultAfter = await vaultBal();

  console.log('settleCleared:', {
    digest: s.digest,
    explorer: s.explorerUrl,
    recipient: s.recipient,
    valueUsdc: s.valueUsdc.toString(),
    settledEvent: { ...s.settled, valueUsdc: s.settled.valueUsdc.toString(), spentThisPeriod: s.settled.spentThisPeriod.toString() },
    balanceChangeFromTx: s.recipientBalanceDelta.toString(),
    payoutCoinId: s.payoutCoinId,
    payoutCoinBalance: s.payoutCoinBalance.toString(),
    gasNetMist: s.gas.netMist.toString(),
  });
  console.log('recipient USDSUI balance (getBalance):', recipBefore.toString(), '->', recipAfter.toString(), 'delta', (recipAfter - recipBefore).toString());
  console.log('vault before:', JSON.stringify(vaultBefore));
  console.log('vault after: ', JSON.stringify(vaultAfter));
  const suiEnd = await suiBal();
  console.log('sender SUI:', suiStart.toString(), '->', suiEnd.toString(), 'spent this run', (suiStart - suiEnd).toString(), 'MIST');
  console.log('task total gas incl. earlier mint:', spent.toString(), 'MIST');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
