/**
 * Shared test inputs. The ids are the real, public testnet ids from
 * move/DEPLOYMENTS.md (the same values committed in the root .env.example).
 * No chain responses are faked anywhere in this suite: no test here
 * submits or reads a transaction. The live proof is
 * scripts/live-testnet.ts, recorded in move/DEPLOYMENTS.md.
 */
import type { Hash32, Verdict } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';

export const REAL_ENV = {
  SUI_BONDED_PACKAGE_ID: '0xf3d914b39722e1c6c3f0e274d088623c0e050d3125b8f658d48b94498efbf57a',
  SUI_VAULT_ID: '0x1c828f5496dfb9200c50f7fcc932cb0edb477265b58978036f4b77018e4dd433',
  SUI_REGISTRY_ID: '0x107a77efbd5ab5ba91d4ec1104205e254a14365484d694ec72a615bea2b912a5',
  SUI_ENFORCER_CAP_ID: '0x60302c2c5682c685daf794b1acf0114bbcfea1d5873066d2860654b1ea5f375d',
  SUI_BOND_COIN_TYPE: '0x832f93729a8b1dfe9dd8067536dfa35231cf019f9401afe04a398df6d18c54cb::usdsui::USDSUI',
} as const;

export const PKG = REAL_ENV.SUI_BONDED_PACKAGE_ID;
export const VAULT = REAL_ENV.SUI_VAULT_ID;
export const REGISTRY = REAL_ENV.SUI_REGISTRY_ID;
export const CAP = REAL_ENV.SUI_ENFORCER_CAP_ID;
export const COIN = REAL_ENV.SUI_BOND_COIN_TYPE;

/** `[1,1,...]` / `[2,2,...]`: the CLI vector literal for a 32-byte hash of a repeated byte. */
export function repeatedVec(byte: number): string {
  return `[${Array.from({ length: 32 }, () => byte).join(',')}]`;
}

export const PROPOSAL_HASH = `0x${'01'.repeat(32)}` as Hash32;
export const POLICY_HASH = `0x${'02'.repeat(32)}` as Hash32;

export function clearedVerdict(): Verdict {
  return {
    proposalHash: PROPOSAL_HASH,
    policyHash: POLICY_HASH,
    outcome: 0,
    reasonCode: ReasonCode.OK,
    blockChecked: 1n,
    logRef: `0x${'03'.repeat(32)}` as Hash32,
  };
}

export function heldVerdict(): Verdict {
  return {
    proposalHash: PROPOSAL_HASH,
    policyHash: POLICY_HASH,
    outcome: 2,
    reasonCode: ReasonCode.PREMISE_HELD_FOR_REVIEW,
    blockChecked: 1n,
    logRef: `0x${'03'.repeat(32)}` as Hash32,
  };
}

/** From packages/villain-corpus/site/spoofed-invoice.html `#fraudulent-payout-address[data-address]` (read, not imported). */
export const FRAUDULENT_GLOBEX_CLAIM = '0xe218026a7210d04d19e4cc677f1c459c5ff353df6915b44e085397fdbdb89187';
