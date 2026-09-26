/**
 * The AP agent's ONE policy.
 *
 * `BondedRegistry` stores one policy hash per agent address, so the agent that
 * pays every demo invoice has exactly one `PolicyArtifact`, committed on-chain
 * once (`scripts/commit-ap-policy.ts`), and the console reads that on-chain
 * hash back (`readPolicyHash`) for every `enforce()` call. It is never
 * recomputed locally as a stand-in for the chain.
 *
 * Premise ids are per vendor (`p-<vendor>-<fact>`). Each invoice's proposal
 * claims only its own vendor's premises; `enforce()` looks each one up by id.
 *
 * Two rules keep this policy's hash stable while the vendor master changes:
 *
 *  1. No premise `value` embeds a vendor-master fact. `enforce()` compares the
 *     proposal's CLAIM against the re-derived truth (`evaluatePremise` never
 *     reads `def.value`), so `value` is documentation only. The per-invoice
 *     policies this replaced put the vendor's current payout address in
 *     `value`; in a committed policy that would change the hash every time a
 *     World-approved bank change updates the vendor master, and every
 *     invoice would then fail STALE_POLICY.
 *  2. A screening premise's subject comes from the proposal, not the policy:
 *     `args: ['claim:p-<vendor>-evm-identity']` is bound by
 *     `@bonded/dispatcher`'s `bindClaimArgs` to whatever EVM identity this
 *     proposal claims for the payee. That is what gets screened by
 *     Intercepta, and the identity premise right after it checks the claim
 *     against the registered identity on file.
 *
 * Order inside each vendor's claims (enforced by how `enforce-deps.ts` builds
 * proposals): the Intercepta screen first, then the hard-refuse facts
 * (status, registered EVM identity), and the `holdOnMismatch` payout premise
 * LAST, so a hold is only ever reached once every hard check has passed. A
 * sanctioned identity is refused, never held for a human who might approve it.
 *
 * Thresholds (6-decimal USDC base units, strings, never floats):
 *  - `irreversibleAboveUSDC` = $10,000.00: the $15,000 halcyon bill holds for a
 *    World step-up; acme ($1,250), globex ($8,450) and suspended-corp ($4,200)
 *    do not.
 *  - `budget.max` = $100,000.00 against the vault's on-chain
 *    `spent_this_period`. That counter is vault-wide and never resets in the
 *    Move module, so the period is labelled `vault-lifetime`, not `daily`.
 */

import type { Address, PolicyArtifact, Premise } from '@bonded/seam';

/** The demo AP agent. Its 20-byte address is zero-left-padded to the registry's 32-byte key on-chain. */
export const AP_AGENT_ADDRESS = `0x${'aa'.repeat(20)}` as Address;
/** The proposal's `action.target`. Not a payout address: settlement always pays the vendor-master truth. */
export const AP_VAULT_TARGET_ADDRESS = `0x${'bb'.repeat(20)}` as Address;

export const IRREVERSIBLE_ABOVE_USDC = '10000000000'; // $10,000.00
export const BUDGET_MAX_USDC = '100000000000'; // $100,000.00

function payout(vendorId: string, prefix: string): Premise {
  return {
    id: `p-${prefix}-payout`,
    schema: 'issuer-oracle-vendors',
    field: 'vendor.payoutAddress',
    op: 'eq',
    value: 'vendor-master:payoutAddress',
    args: [vendorId],
    holdOnMismatch: true,
  };
}

function status(vendorId: string, prefix: string): Premise {
  return { id: `p-${prefix}-status`, schema: 'issuer-oracle-vendors', field: 'vendor.status', op: 'eq', value: 'active', args: [vendorId] };
}

function evmIdentity(vendorId: string, prefix: string): Premise {
  return {
    id: `p-${prefix}-evm-identity`,
    schema: 'issuer-oracle-vendors',
    field: 'vendor.evmAddress',
    op: 'eq',
    value: 'vendor-master:evmAddress',
    args: [vendorId],
  };
}

/**
 * `intercepta-risk` / `payment.payTo.traitCount lte 0` on the payee's CLAIMED
 * EVM identity. Any documented risk trait (sanction_address, known_scammer,
 * mixer_transfers, ...) is a hard refuse; no threshold on `toxicScore`, whose
 * range is undocumented (docs/VERIFY_FINDINGS.md item 5). Fail-closed: with no
 * INTERCEPTA_API_KEY this premise is unresolvable and the invoice is REFUSED.
 */
function screen(prefix: string): Premise {
  return {
    id: `p-${prefix}-screen`,
    schema: 'intercepta-risk',
    field: 'payment.payTo.traitCount',
    op: 'lte',
    value: '0',
    args: [`claim:p-${prefix}-evm-identity`],
  };
}

export const AP_AGENT_POLICY: PolicyArtifact = {
  version: 1,
  budget: { asset: 'USDC', period: 'vault-lifetime', max: BUDGET_MAX_USDC },
  premises: [
    // acme: key-free by design (no screen), so the clean path runs without any sponsor key.
    payout('vnd-acme-supplies', 'acme'),
    status('vnd-acme-supplies', 'acme'),
    // globex: screened (both globex invoices claim an EVM identity).
    screen('globex'),
    status('vnd-globex-freight', 'globex'),
    evmIdentity('vnd-globex-freight', 'globex'),
    payout('vnd-globex-freight', 'globex'),
    // suspended-corp: key-free, status only.
    status('vnd-suspended-corp', 'suspended'),
    // halcyon: screened, and over the irreversible threshold.
    screen('halcyon'),
    status('vnd-halcyon-machining', 'halcyon'),
    evmIdentity('vnd-halcyon-machining', 'halcyon'),
    payout('vnd-halcyon-machining', 'halcyon'),
  ],
  forbid: [],
  irreversibleAboveUSDC: IRREVERSIBLE_ABOVE_USDC,
};
