/**
 * Risk pricing: an Intercepta verdict turned into BLOCK or a stake. PRD C.2 and C.3.
 *
 *   hard flag           -> BLOCK (refuse, no bond)
 *   positively no data  -> PRICE at R_UNKNOWN_BPS (6000, from seam)
 *   otherwise           -> PRICE at R_bps derived from toxicScore
 *                          (REFUSES TO RUN until the toxicScore range is confirmed)
 *
 * The stake arithmetic is entirely @bonded/seam: `riskToStakeMultiplierBps` and
 * `requiredStake`. This file never re-derives it and never uses a float: R_bps
 * is an integer and amounts are bigint (CLAUDE.md rule 2).
 *
 * Every error THROWS. No error is ever priced as unknown, and none is ever
 * treated as clean (CLAUDE.md rule 1).
 */
import {
  R_UNKNOWN_BPS,
  requiredStake as seamRequiredStake,
  riskToStakeMultiplierBps,
} from '@bonded/seam';
import {
  InterceptaShapeError,
  checkAddressActivity,
  isDocumentedTraitName,
  parseScreeningSubject,
  readApiKey,
  scanAddress,
  type AddressScanKind,
  type InterceptaCallOptions,
  type ScanEvidence,
  type TraitName,
} from './intercepta.js';

// ─── Hard flags ─────────────────────────────────────────────────────────────
//
// Source of the names: the OAS enum `ToxicScoreTraitV2.name`, identical on
// https://docs.web3antivirus.io/reference/quick-scan-address.md and
// /scan-address.md. `traits` is documented as "List of suspicious activities
// detected on the address", so a trait's PRESENCE is the detection.
//
// Intercepta does NOT document a severity per trait. Its Scam and Risk Library
// classifies token and contract risks as "Critical" or "Moderate", but lists
// address activities only under "Suspicious activity", with no severity. So the
// split below is PROJECT POLICY over the documented names, not an Intercepta
// statement. The rule: a HARD flag says the address itself IS the bad actor or
// is listed (PRD A: "sanctioned, scam-linked"). A PRICED trait says it was near
// one, or is merely suspicious. That is exactly the risk a bond prices rather
// than refuses.
// UNCONFIRMED: each trait's exact meaning beyond its name. The runtime
// `description` field will confirm it, and the live script prints it.
// Trait `risk` values are NOT used, because their range is undocumented.

export const HARD_FLAG_TRAITS: ReadonlySet<TraitName> = new Set<TraitName>([
  'sanction_address', // Library: "Sanctions — An address is under sanctions."
  'known_scammer', // Library: "Scam — An address involved in fraud schemes."
  'initiator_scam_transactions', // the address initiated scam transactions itself
  'blacklist', // the address is on a blacklist
  'rug_pull', // Library: "Rug pull — An address involved in rug pull scams."
  'fake_phishing_transfer', // Library: "Phishing — An address involved in phishing." (poisoning sender)
]);

export const PRICED_TRAITS: ReadonlySet<TraitName> = new Set<TraitName>([
  'sanction_address_communication', // exposure: transacted with a sanctioned address
  'mixer_transfers', // exposure
  'non_kyc_transfers', // exposure
  'fake_phishing_contract_communication', // exposure
  'rug_pull_trader', // traded a rug-pull token; often the victim
  'attack_money_target', // target of an attack; often the victim
  'zero_address_risk', // pattern signal, not an identity
  'suspicious_deployer', // "suspicious", not established
  'suspicious_dex_pair_deployer', // "suspicious", not established
]);

/** Throws on a name outside the documented enum; it is never read as clean. */
export function classifyTrait(name: string): 'HARD_FLAG' | 'PRICED' {
  if (!isDocumentedTraitName(name)) {
    throw new InterceptaShapeError(`trait ${JSON.stringify(name)} is not in the documented enum`);
  }
  if (HARD_FLAG_TRAITS.has(name)) return 'HARD_FLAG';
  if (PRICED_TRAITS.has(name)) return 'PRICED';
  throw new Error(`documented trait ${name} is unclassified (a bug in risk.ts)`);
}

// ─── toxicScore -> R_bps ────────────────────────────────────────────────────

export interface ToxicScoreScale {
  /** Lowest score the API can return. Integer. */
  min: number;
  /** Highest score the API can return. Integer, > min. */
  max: number;
  /** True if a larger toxicScore means riskier (the name suggests so, but that is unconfirmed). */
  higherIsRiskier: boolean;
}

export type ToxicScoreRange =
  | { status: 'UNCONFIRMED'; why: string }
  | ({ status: 'CONFIRMED'; source: string } & ToxicScoreScale);

/**
 * UNCONFIRMED. The OAS types `toxicScore` as `number`, with no minimum, maximum,
 * scale or direction (docs/VERIFY_FINDINGS.md item 5). Per CLAUDE.md's
 * [VERIFY] rule it is not guessed. To confirm it, replace this with
 * `{ status: 'CONFIRMED', min, max, higherIsRiskier, source }`. Take the values
 * from real stored responses (cite their sha256 in `source`) or from a written
 * Intercepta statement, and update the gate test in risk.test.ts in the same change.
 */
export const TOXIC_SCORE_RANGE: ToxicScoreRange = {
  status: 'UNCONFIRMED',
  why:
    'ToxicScoreShortResponseV2.toxicScore is documented only as "number"; no range, scale or ' +
    'direction is published (docs/VERIFY_FINDINGS.md item 5)',
};

export class ToxicScoreRangeUnconfirmedError extends Error {
  constructor(
    readonly observedToxicScore: number,
    readonly evidence: ScanEvidence | null,
  ) {
    super(
      `refusing to price toxicScore=${observedToxicScore}: TOXIC_SCORE_RANGE is UNCONFIRMED ` +
        `(${(TOXIC_SCORE_RANGE as { why?: string }).why ?? 'see risk.ts'}). No quote was produced.` +
        (evidence ? ` Response stored at ${evidence.storedAt} (sha256 ${evidence.sha256}).` : ''),
    );
    this.name = 'ToxicScoreRangeUnconfirmedError';
  }
}

function assertSafeInteger(name: string, v: number): void {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new RangeError(`${name} must be a safe integer, got ${v}`);
  }
}

/**
 * Pure: map an integer score within `[min, max]` to an integer R_bps in 0..10000.
 *
 *   offset = higherIsRiskier ? score - min : max - score
 *   R_bps  = ceil(offset * 10000 / (max - min))
 *
 * All the arithmetic is bigint, so no fractional value ever exists. The
 * rounding is UP, which is conservative: rounding can only raise the stake,
 * never lower it. An out-of-range, fractional or non-finite score throws; it is
 * not clamped.
 * A fractional score is refused on purpose. If real responses turn out to carry
 * fractions, this conversion needs a decimal-string path, not a float.
 */
export function toxicScoreToRiskBps(score: number, scale: ToxicScoreScale): number {
  assertSafeInteger('toxicScore', score);
  assertSafeInteger('range.min', scale.min);
  assertSafeInteger('range.max', scale.max);
  if (typeof scale.higherIsRiskier !== 'boolean') {
    throw new RangeError('range.higherIsRiskier must be a boolean');
  }
  if (scale.min >= scale.max) {
    throw new RangeError(`range.min (${scale.min}) must be < range.max (${scale.max})`);
  }
  if (score < scale.min || score > scale.max) {
    throw new RangeError(`toxicScore ${score} is outside the range ${scale.min}..${scale.max}`);
  }
  const span = BigInt(scale.max) - BigInt(scale.min);
  const offset = scale.higherIsRiskier ? BigInt(score) - BigInt(scale.min) : BigInt(scale.max) - BigInt(score);
  return Number((offset * 10_000n + span - 1n) / span);
}

function confirmedScale(range: ToxicScoreRange, score: number, evidence: ScanEvidence | null): ToxicScoreScale {
  if (range.status !== 'CONFIRMED') throw new ToxicScoreRangeUnconfirmedError(score, evidence);
  return range;
}

/** Uses TOXIC_SCORE_RANGE, and throws while that range is UNCONFIRMED. */
export function riskBpsFromToxicScore(score: number, evidence: ScanEvidence | null = null): number {
  return toxicScoreToRiskBps(score, confirmedScale(TOXIC_SCORE_RANGE, score, evidence));
}

// ─── Stake, via seam ────────────────────────────────────────────────────────

/** "Positively no data" is priced at seam's disclosed R_unknown (PRD C.3), never at a local copy. */
export const NO_HISTORY_RISK_BPS = R_UNKNOWN_BPS;

function assertPrice(price: bigint): void {
  if (typeof price !== 'bigint') {
    throw new TypeError(`price must be a bigint in 6-decimal base units, got ${typeof price}`);
  }
  if (price <= 0n) throw new RangeError(`price must be positive, got ${price}`);
}

/** The multiplier and per-side stake for `price` at integer `riskBps`: seam's math, called, not copied. */
export function priceAtRisk(
  price: bigint,
  riskBps: number,
): { riskBps: number; multiplierBps: number; requiredStake: bigint } {
  assertPrice(price);
  const multiplierBps = riskToStakeMultiplierBps(riskBps);
  return { riskBps, multiplierBps, requiredStake: seamRequiredStake(price, riskBps) };
}

// ─── The quote ──────────────────────────────────────────────────────────────

export interface BlockQuote {
  decision: 'BLOCK';
  subject: string;
  scan: AddressScanKind;
  /** Human-readable, including each trait's API description (PRD H: "reason visible"). */
  reason: string;
  hardFlags: TraitName[];
  evidence: ScanEvidence;
}

export interface PriceQuote {
  decision: 'PRICE';
  subject: string;
  scan: AddressScanKind;
  /** NO_HISTORY: check-activity said `hasActivity: false` and the scan found no traits. */
  basis: 'NO_HISTORY' | 'TOXIC_SCORE';
  riskBps: number;
  multiplierBps: number;
  /** Transaction value, 6-decimal base units. */
  price: bigint;
  /** Stake EACH side posts, 6-decimal base units. */
  requiredStake: bigint;
  /** The address scan that priced this. */
  evidence: ScanEvidence;
  /** The activity check that established (or ruled out) "no history". */
  activityEvidence: ScanEvidence;
}

export type RiskQuote = BlockQuote | PriceQuote;

export interface QuoteOptions extends InterceptaCallOptions {
  /** Default 'quick-scan', the pre-commit scan in PRD C.2. 'toxic-score' is Deep Scan. */
  scan?: AddressScanKind;
}

/**
 * Live quote for `subject` (an EVM address or ENS name) at `price` (6-decimal base units).
 *
 * 1. Validate inputs and the key. All three throw before any network call.
 * 2. Address scan, live. Any HARD_FLAG trait -> BLOCK.
 * 3. Check Address Activity, live. `hasActivity: false` with no traits at all is
 *    a positive "no data" answer -> PRICE at R_UNKNOWN_BPS. This is the only way
 *    to reach R_unknown. The scan schema has no "unknown" verdict (PRD A assumes
 *    one exists). Check Address Activity's documented contract is "Checks
 *    whether a blockchain address has any prior on-chain activity... If none of
 *    the above are found, the address is treated as unused."
 * 4. Otherwise R_bps comes from toxicScore. That THROWS until TOXIC_SCORE_RANGE
 *    is confirmed.
 *
 * Known imprecision, and it errs safe: activity is checked on chain 1 only. An
 * address active only on an L2 with no traits prices as unknown (6000 bps, a
 * higher stake), never lower.
 */
export async function quoteRisk(subject: string, price: bigint, options: QuoteOptions = {}): Promise<RiskQuote> {
  parseScreeningSubject(subject);
  assertPrice(price);
  readApiKey();

  const scanKind = options.scan ?? 'quick-scan';
  const { result: scan, evidence } = await scanAddress(subject, scanKind, options);

  const hard = scan.traits.filter((t) => classifyTrait(t.name) === 'HARD_FLAG');
  if (hard.length > 0) {
    return {
      decision: 'BLOCK',
      subject: evidence.subject,
      scan: scanKind,
      reason:
        `Intercepta ${scanKind} hard flag: ` +
        hard.map((t) => `${t.name} (${t.txsCount} txs: ${t.description})`).join('; '),
      hardFlags: hard.map((t) => t.name),
      evidence,
    };
  }

  const { result: activity, evidence: activityEvidence } = await checkAddressActivity(subject, options);

  const noHistory = !activity.hasActivity && scan.traits.length === 0;
  const riskBps = noHistory ? NO_HISTORY_RISK_BPS : riskBpsFromToxicScore(scan.toxicScore, evidence);
  return {
    decision: 'PRICE',
    subject: evidence.subject,
    scan: scanKind,
    basis: noHistory ? 'NO_HISTORY' : 'TOXIC_SCORE',
    ...priceAtRisk(price, riskBps),
    price,
    evidence,
    activityEvidence,
  };
}
