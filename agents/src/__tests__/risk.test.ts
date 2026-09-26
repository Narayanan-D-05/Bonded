/**
 * PRD Part M, "Risk pricing" row: `riskToStakeMultiplierBps` correct at R=0,
 * R=R_unknown, R=max; integer arithmetic only; no float ever enters the path.
 *
 * There are NO Intercepta response bodies in this file, fabricated or
 * otherwise (CLAUDE.md rule 1, and the project's no-mocks rule). What is tested
 * is everything that does not need one:
 *   - the stake arithmetic, through @bonded/seam (never reimplemented here);
 *   - the pure toxicScore -> R_bps conversion, with the range as a parameter;
 *   - the refusal paths: unconfirmed range, missing key, bad subjects, bad
 *     prices, and inputs that are not a response object at all.
 * The positive parse of a real response is exercised by `scripts/risk-live.ts`
 * against the live API once a key exists.
 */
import {
  MIN_MULTIPLIER_BPS,
  R_MAX_BPS,
  R_UNKNOWN_BPS,
  riskToStakeMultiplierBps,
} from '@bonded/seam';
import {
  DOCUMENTED_TRAIT_NAMES,
  ENV_LINE_TO_ADD,
  INTERCEPTA_API_KEY_ENV,
  InterceptaKeyMissingError,
  InterceptaShapeError,
  InterceptaSubjectError,
  checkAddressActivity,
  parseAddressActivityResponse,
  parseScreeningSubject,
  parseToxicScoreResponse,
  readApiKey,
  scanAddress,
} from '../intercepta.js';
import {
  HARD_FLAG_TRAITS,
  NO_HISTORY_RISK_BPS,
  PRICED_TRAITS,
  TOXIC_SCORE_RANGE,
  ToxicScoreRangeUnconfirmedError,
  classifyTrait,
  priceAtRisk,
  quoteRisk,
  riskBpsFromToxicScore,
  toxicScoreToRiskBps,
} from '../risk.js';

const EVM = '0x0d775e010f0b6c32c9468d43ba599ef47d596e47'; // the docs' own example parameter
/** A 32-byte Sui-shaped address (0x + 64 hex). Shape only; it is never sent anywhere. */
const SUI = `0x${'990acf44'}${'a'.repeat(52)}${'0d43'}`;
const ONE_USD = 1_000_000n; // 6-decimal base units

// ─── Stake pricing at the PRD boundary values, through seam ─────────────────

describe('priceAtRisk: stake math is seam, at the Part M boundaries', () => {
  test('R = 0 -> 1.05x floor', () => {
    const p = priceAtRisk(ONE_USD, 0);
    expect(p).toEqual({ riskBps: 0, multiplierBps: 10_500, requiredStake: 1_050_000n });
    expect(p.multiplierBps).toBe(MIN_MULTIPLIER_BPS);
  });

  test('R = R_unknown (6000) -> 1.95x', () => {
    const p = priceAtRisk(ONE_USD, R_UNKNOWN_BPS);
    expect(p).toEqual({ riskBps: 6000, multiplierBps: 19_500, requiredStake: 1_950_000n });
  });

  test('R = max (10000) -> 2.55x', () => {
    const p = priceAtRisk(ONE_USD, R_MAX_BPS);
    expect(p).toEqual({ riskBps: 10_000, multiplierBps: 25_500, requiredStake: 2_550_000n });
  });

  test('agrees with seam at every boundary, and the stake is a bigint', () => {
    for (const r of [0, 1, 5_000, R_UNKNOWN_BPS, 9_999, R_MAX_BPS]) {
      const p = priceAtRisk(ONE_USD, r);
      expect(p.multiplierBps).toBe(riskToStakeMultiplierBps(r));
      expect(typeof p.requiredStake).toBe('bigint');
      expect(Number.isInteger(p.multiplierBps)).toBe(true);
    }
  });

  test('stake strictly exceeds price even for one base unit (seam ceiling division)', () => {
    expect(priceAtRisk(1n, 0).requiredStake).toBe(2n);
    expect(priceAtRisk(1n, 0).requiredStake > 1n).toBe(true);
  });

  test('the no-history score is seam R_UNKNOWN_BPS, not a local copy', () => {
    expect(NO_HISTORY_RISK_BPS).toBe(R_UNKNOWN_BPS);
  });

  test('refuses fractional, negative and out-of-range R (no rounding, no clamping)', () => {
    expect(() => priceAtRisk(ONE_USD, 5_000.5)).toThrow(RangeError);
    expect(() => priceAtRisk(ONE_USD, -1)).toThrow(RangeError);
    expect(() => priceAtRisk(ONE_USD, 10_001)).toThrow(RangeError);
    expect(() => priceAtRisk(ONE_USD, Number.NaN)).toThrow(RangeError);
  });

  test('refuses a zero, negative or non-bigint price', () => {
    expect(() => priceAtRisk(0n, 0)).toThrow(RangeError);
    expect(() => priceAtRisk(-1n, 0)).toThrow(RangeError);
    // @ts-expect-error a number amount is exactly the bug CLAUDE.md rule 2 forbids
    expect(() => priceAtRisk(1.5, 0)).toThrow(TypeError);
  });
});

// ─── toxicScore -> R_bps, the pure integer conversion ───────────────────────

describe('toxicScoreToRiskBps: pure, integer-only, range as a parameter', () => {
  const r0to100 = { min: 0, max: 100, higherIsRiskier: true } as const;

  test('boundaries map to exactly 0 and 10000', () => {
    expect(toxicScoreToRiskBps(0, r0to100)).toBe(0);
    expect(toxicScoreToRiskBps(100, r0to100)).toBe(10_000);
  });

  test('interior points on an evenly dividing range', () => {
    expect(toxicScoreToRiskBps(1, r0to100)).toBe(100);
    expect(toxicScoreToRiskBps(50, r0to100)).toBe(5_000);
    expect(toxicScoreToRiskBps(99, r0to100)).toBe(9_900);
  });

  test('rounds UP on a non-dividing range (conservative: more stake, never less)', () => {
    const r0to3 = { min: 0, max: 3, higherIsRiskier: true } as const;
    expect(toxicScoreToRiskBps(1, r0to3)).toBe(3_334); // 3333.33.. -> 3334
    expect(toxicScoreToRiskBps(2, r0to3)).toBe(6_667); // 6666.66.. -> 6667
    expect(toxicScoreToRiskBps(3, r0to3)).toBe(10_000);
  });

  test('inverted scale (lower score = riskier)', () => {
    const inv = { min: 0, max: 100, higherIsRiskier: false } as const;
    expect(toxicScoreToRiskBps(0, inv)).toBe(10_000);
    expect(toxicScoreToRiskBps(100, inv)).toBe(0);
    expect(toxicScoreToRiskBps(25, inv)).toBe(7_500);
  });

  test('a range that does not start at zero', () => {
    const r = { min: -10, max: 10, higherIsRiskier: true } as const;
    expect(toxicScoreToRiskBps(-10, r)).toBe(0);
    expect(toxicScoreToRiskBps(0, r)).toBe(5_000);
    expect(toxicScoreToRiskBps(10, r)).toBe(10_000);
  });

  test('a one-step range', () => {
    const r = { min: 0, max: 1, higherIsRiskier: true } as const;
    expect(toxicScoreToRiskBps(0, r)).toBe(0);
    expect(toxicScoreToRiskBps(1, r)).toBe(10_000);
  });

  test('every output is an integer in 0..10000 and feeds seam without error', () => {
    const r = { min: 0, max: 7, higherIsRiskier: true } as const;
    for (let s = 0; s <= 7; s += 1) {
      const bps = toxicScoreToRiskBps(s, r);
      expect(Number.isInteger(bps)).toBe(true);
      expect(bps).toBeGreaterThanOrEqual(0);
      expect(bps).toBeLessThanOrEqual(10_000);
      expect(() => riskToStakeMultiplierBps(bps)).not.toThrow();
    }
  });

  test('refuses a score outside the range instead of clamping it', () => {
    expect(() => toxicScoreToRiskBps(101, r0to100)).toThrow(RangeError);
    expect(() => toxicScoreToRiskBps(-1, r0to100)).toThrow(RangeError);
  });

  test('refuses a fractional or non-finite score (no float enters the path)', () => {
    expect(() => toxicScoreToRiskBps(50.5, r0to100)).toThrow(RangeError);
    expect(() => toxicScoreToRiskBps(Number.NaN, r0to100)).toThrow(RangeError);
    expect(() => toxicScoreToRiskBps(Number.POSITIVE_INFINITY, r0to100)).toThrow(RangeError);
    expect(() => toxicScoreToRiskBps(2 ** 53, { min: 0, max: 2 ** 53, higherIsRiskier: true })).toThrow(
      RangeError,
    );
  });

  test('refuses a malformed range', () => {
    expect(() => toxicScoreToRiskBps(0, { min: 0, max: 0, higherIsRiskier: true })).toThrow(RangeError);
    expect(() => toxicScoreToRiskBps(0, { min: 5, max: 1, higherIsRiskier: true })).toThrow(RangeError);
    expect(() => toxicScoreToRiskBps(0, { min: 0, max: 1.5, higherIsRiskier: true })).toThrow(RangeError);
    expect(() => toxicScoreToRiskBps(0, { min: 0.5, max: 2, higherIsRiskier: true })).toThrow(RangeError);
  });
});

describe('riskBpsFromToxicScore: refuses to run until the range is confirmed', () => {
  test('the range is still marked UNCONFIRMED (VERIFY_FINDINGS item 5)', () => {
    // When a real response confirms the range, this test is updated in the same
    // change that fills in TOXIC_SCORE_RANGE. It is the gate, stated as a test.
    expect(TOXIC_SCORE_RANGE.status).toBe('UNCONFIRMED');
  });

  test('throws for every score, including the ones that would look "clean"', () => {
    for (const s of [0, 1, 50, 100, 10_000]) {
      expect(() => riskBpsFromToxicScore(s)).toThrow(ToxicScoreRangeUnconfirmedError);
    }
  });
});

// ─── Hard-flag classification over the documented trait enum ────────────────

describe('trait classification', () => {
  test('every documented trait name is classified exactly once', () => {
    const hard = [...HARD_FLAG_TRAITS];
    const priced = [...PRICED_TRAITS];
    expect(new Set([...hard, ...priced])).toEqual(new Set(DOCUMENTED_TRAIT_NAMES));
    expect(hard.filter((n) => PRICED_TRAITS.has(n))).toEqual([]);
    expect(hard.length + priced.length).toBe(DOCUMENTED_TRAIT_NAMES.length);
  });

  test('sanctioned, known-scammer and blacklisted addresses are hard flags', () => {
    expect(classifyTrait('sanction_address')).toBe('HARD_FLAG');
    expect(classifyTrait('known_scammer')).toBe('HARD_FLAG');
    expect(classifyTrait('blacklist')).toBe('HARD_FLAG');
  });

  test('mere exposure (communicated with a sanctioned address) is priced, not blocked', () => {
    expect(classifyTrait('sanction_address_communication')).toBe('PRICED');
    expect(classifyTrait('mixer_transfers')).toBe('PRICED');
  });

  test('an undocumented trait name throws rather than being read as clean', () => {
    expect(() => classifyTrait('something_new')).toThrow(InterceptaShapeError);
  });
});

// ─── Subjects: EVM or ENS only ──────────────────────────────────────────────

describe('parseScreeningSubject', () => {
  test('accepts a 20-byte EVM address in any case', () => {
    expect(parseScreeningSubject(EVM)).toEqual({ kind: 'evm', value: EVM });
    expect(parseScreeningSubject(EVM.toUpperCase().replace('0X', '0x')).kind).toBe('evm');
    expect(parseScreeningSubject('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045').kind).toBe('evm');
  });

  test('accepts a normalised ENS name', () => {
    expect(parseScreeningSubject('vitalik.eth')).toEqual({ kind: 'ens', value: 'vitalik.eth' });
    expect(parseScreeningSubject('agent-1.agents.eth').kind).toBe('ens');
  });

  test('rejects a Sui address with an error that says why', () => {
    expect(() => parseScreeningSubject(SUI)).toThrow(InterceptaSubjectError);
    expect(() => parseScreeningSubject(SUI)).toThrow(/Sui/);
  });

  test('rejects a SuiNS name', () => {
    expect(() => parseScreeningSubject('agent.sui')).toThrow(/Sui/);
  });

  test('rejects malformed input', () => {
    for (const bad of [
      '',
      ' ',
      `${EVM} `,
      ` ${EVM}`,
      EVM.slice(0, -1), // 39 hex chars
      `${EVM}0`, // 41 hex chars
      EVM.slice(2), // no 0x
      '0xZZ5e010f0b6c32c9468d43ba599ef47d596e47',
      'eth', // single label
      'Vitalik.eth', // not normalised
      'vitalik..eth',
      '.eth',
      'vitalik.eth.',
      'http://vitalik.eth',
      '../../account',
    ]) {
      expect(() => parseScreeningSubject(bad)).toThrow(InterceptaSubjectError);
    }
  });

  test('rejects a non-string', () => {
    // @ts-expect-error runtime guard for untyped callers
    expect(() => parseScreeningSubject(123)).toThrow(InterceptaSubjectError);
  });
});

// ─── Missing key: throws, never a price ─────────────────────────────────────

describe('missing INTERCEPTA_API_KEY', () => {
  const saved = process.env[INTERCEPTA_API_KEY_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[INTERCEPTA_API_KEY_ENV];
    else process.env[INTERCEPTA_API_KEY_ENV] = saved;
  });

  for (const [label, value] of [
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ] as const) {
    test(`${label}: readApiKey throws a visible error naming the .env line`, () => {
      if (value === undefined) delete process.env[INTERCEPTA_API_KEY_ENV];
      else process.env[INTERCEPTA_API_KEY_ENV] = value;
      expect(() => readApiKey()).toThrow(InterceptaKeyMissingError);
      expect(() => readApiKey()).toThrow(ENV_LINE_TO_ADD);
    });

    test(`${label}: quoteRisk rejects and returns no quote`, async () => {
      if (value === undefined) delete process.env[INTERCEPTA_API_KEY_ENV];
      else process.env[INTERCEPTA_API_KEY_ENV] = value;
      let quote: unknown = 'never assigned';
      await expect(
        (async () => {
          quote = await quoteRisk(EVM, ONE_USD);
        })(),
      ).rejects.toBeInstanceOf(InterceptaKeyMissingError);
      expect(quote).toBe('never assigned');
    });

    test(`${label}: every live call rejects before touching the network`, async () => {
      if (value === undefined) delete process.env[INTERCEPTA_API_KEY_ENV];
      else process.env[INTERCEPTA_API_KEY_ENV] = value;
      await expect(scanAddress(EVM, 'quick-scan')).rejects.toBeInstanceOf(InterceptaKeyMissingError);
      await expect(scanAddress(EVM, 'toxic-score')).rejects.toBeInstanceOf(InterceptaKeyMissingError);
      await expect(checkAddressActivity(EVM)).rejects.toBeInstanceOf(InterceptaKeyMissingError);
    });
  }

  test('the key is read at call time, not captured at import', () => {
    delete process.env[INTERCEPTA_API_KEY_ENV];
    expect(() => readApiKey()).toThrow(InterceptaKeyMissingError);
    process.env[INTERCEPTA_API_KEY_ENV] = 'present-for-this-assertion-only';
    expect(readApiKey()).toBe('present-for-this-assertion-only');
  });
});

// ─── Input refusal happens before any network call ──────────────────────────

describe('quoteRisk validates inputs before anything else', () => {
  test('bad subject or bad price is refused ahead of the key check', async () => {
    const saved = process.env[INTERCEPTA_API_KEY_ENV];
    delete process.env[INTERCEPTA_API_KEY_ENV];
    try {
      // With no key set, reaching the network is impossible; the specific error
      // type proves validation ran first.
      await expect(quoteRisk(SUI, ONE_USD)).rejects.toBeInstanceOf(InterceptaSubjectError);
      await expect(quoteRisk(EVM, 0n)).rejects.toBeInstanceOf(RangeError);
      // @ts-expect-error a number amount is exactly the bug CLAUDE.md rule 2 forbids
      await expect(quoteRisk(EVM, 1.5)).rejects.toBeInstanceOf(TypeError);
    } finally {
      if (saved !== undefined) process.env[INTERCEPTA_API_KEY_ENV] = saved;
    }
  });
});

// ─── Shape validation fails closed ──────────────────────────────────────────

describe('response validation refuses anything that is not a response object', () => {
  // Deliberately only non-objects and the empty object: none of these is a
  // stand-in for an Intercepta response, so nothing here is a fabricated body.
  const notResponses: unknown[] = [null, undefined, 0, 'ok', true, [], {}];

  test('ToxicScoreShortResponseV2 parser', () => {
    for (const v of notResponses) {
      expect(() => parseToxicScoreResponse(v)).toThrow(InterceptaShapeError);
    }
  });

  test('AddressActivityResponseDTO parser', () => {
    for (const v of notResponses) {
      expect(() => parseAddressActivityResponse(v)).toThrow(InterceptaShapeError);
    }
  });
});
