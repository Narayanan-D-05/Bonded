/**
 * Canonical seam types — Bonded Commerce Edition.
 *
 * These are the Proposal/Verdict/ReasonCode/PolicyArtifact shapes from the
 * Implementation PRD's Part C.1, carried over UNCHANGED by the Commerce
 * Edition migration (BONDED_COMMERCE_MIGRATION_PRD.md Part D.2): only the
 * schema STRING VALUES that `Premise.schema` references are new
 * ('intercepta-risk', 'issuer-oracle-tickets', 'issuer-oracle-ecomm').
 *
 * `Premise.schema` stays a plain `string`, not a union of those literals —
 * this package must have zero dependency on the packages that define those
 * schemas (@bonded/intercepta-adapter, @bonded/issuer-oracle). Whichever
 * package owns `resolvePremise`'s dispatch table is the only place that
 * needs to know the concrete schema names.
 *
 * Amounts that move money are always string-encoded here and turned into
 * `bigint` at the point of use — see money.ts for why they are never a
 * `number` (CLAUDE.md rule 2).
 *
 * Zero runtime dependencies (PRD Part D.1 build order: this package compiles
 * before anything else in the seam).
 */

export type Address = `0x${string}`;
export type Hash32 = `0x${string}`;

export type PremiseOp = 'gte' | 'lte' | 'eq' | 'older_than' | 'younger_than';

export interface Premise {
  id: string;
  /**
   * Which adapter's dispatch table resolves this premise, e.g.
   * 'intercepta-risk' | 'issuer-oracle-tickets' | 'issuer-oracle-ecomm'.
   * Deliberately a plain `string` — see the file header.
   */
  schema: string;
  /** Dot-path into the schema's canonical entity, e.g. 'ticket.faceValueUSD'. */
  field: string;
  op: PremiseOp;
  /** Always string-encoded — never parse this as a float. */
  value: string;
  toleranceBps?: number;
  /** On mismatch, produce HELD_FOR_STEPUP instead of a hard REFUSE. Default false = today's behavior. */
  holdOnMismatch?: boolean;
  /** Ordered subject args (vendorId, address, chain...) the dispatcher passes to the adapter's field fn. */
  args?: string[];
}

export interface Proposal {
  /** keccak256 of the canonical JSON below, minus this field. */
  id: Hash32;
  agent: Address;
  action: {
    /** Enumerated kinds the vault understands — 'swap' | 'transfer' | ... */
    kind: string;
    target: Address;
    calldata: `0x${string}`;
    /** 6-decimal fixed point, ALWAYS a string. */
    valueUSDC: string;
  };
  premises: Array<{ premiseId: string; claimedValue: string }>;
  createdAt: number;
}

export enum ReasonCode {
  OK = 0,
  PREMISE_MISMATCH = 1,
  PREMISE_UNRESOLVABLE = 2,
  POLICY_FORBIDDEN_ACTION = 3,
  BUDGET_EXCEEDED = 4,
  STALE_POLICY = 5,
  IRREVERSIBLE_UNCONFIRMED = 6,
  PREMISE_HELD_FOR_REVIEW = 7,
}

export interface Verdict {
  proposalHash: Hash32;
  policyHash: Hash32;
  /** 0 = CLEARED, 1 = REFUSED, 2 = HELD_FOR_STEPUP. */
  outcome: 0 | 1 | 2;
  reasonCode: ReasonCode;
  blockChecked: bigint;
  logRef: Hash32;
}

export interface PolicyArtifact {
  version: number;
  budget: { asset: 'USDC'; period: string; max: string };
  premises: Premise[];
  forbid: string[];
  irreversibleAboveUSDC: string;
}
