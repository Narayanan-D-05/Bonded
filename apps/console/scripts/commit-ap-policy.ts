/**
 * Commits the AP agent's ONE policy (`lib/ap-policy.ts`) to `BondedRegistry` on Sui testnet,
 * then reads it back. Idempotent: if the registry already holds this exact hash, nothing is
 * submitted. Signs through the Sui CLI keystore (`@bonded/sui-settlement`, CLAUDE.md rule 3).
 *
 *   SUI_* ids in env (public values: move/DEPLOYMENTS.md, root .env.example), then
 *   pnpm --filter @bonded/console commit:policy
 */
import { canonicalHash } from '@bonded/dispatcher';
import { commitPolicy, readPolicyHash } from '@bonded/sui-settlement';
import { AP_AGENT_ADDRESS, AP_AGENT_POLICY } from '../lib/ap-policy';

async function main(): Promise<void> {
  const policyHash = canonicalHash(AP_AGENT_POLICY);
  console.log('AP agent:', AP_AGENT_ADDRESS);
  console.log('AP policy canonicalHash:', policyHash);
  const before = await readPolicyHash(AP_AGENT_ADDRESS);
  console.log('registry before:', before);
  if (before?.toLowerCase() === policyHash.toLowerCase()) {
    console.log('registry already holds this hash; nothing submitted.');
    return;
  }
  const c = await commitPolicy(AP_AGENT_ADDRESS, policyHash);
  console.log('commitPolicy:', {
    digest: c.digest,
    explorer: c.explorerUrl,
    agentKey: c.agentKey,
    onchainPolicyHash: c.onchainPolicyHash,
    gasNetMist: c.gas.netMist.toString(),
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
