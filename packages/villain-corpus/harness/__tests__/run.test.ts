/**
 * Asserts the three core BEC scenarios' real outcomes deterministically — no
 * live network dependency. Imports `buildScenario*`/`runScenario` directly
 * from `../run.js` rather than shelling out to the script, so `main()` (which
 * writes `results.json` and runs the key-gated optional Intercepta scenario)
 * never executes as a side effect of this test file (see `run.ts`'s
 * `isMainModule` guard).
 *
 * Every `enforce()` call here is REAL — routed through the real
 * `@bonded/dispatcher` router against the real `@bonded/issuer-oracle`
 * vendor fixture, exactly as `harness/run.ts` does. Nothing in this file
 * mocks `resolvePremise`, `enforce`, or any vendor data.
 */
import { ReasonCode } from '@bonded/seam';
import {
  INTERCEPTA_SCREEN_PREMISE_ID,
  buildInterceptaScreenScenario,
  buildScenario1,
  buildScenario2,
  buildScenario3,
  runInterceptaScreenScenario,
  runScenario,
} from '../run.js';
import {
  extractClaimedEvmIdentity,
  proposeNaivePayment,
  readClaimedEvmIdentity,
  readFraudulentPayoutAddress,
} from '../naive-ap-agent.js';

/**
 * The live OFAC SDN list (https://www.treasury.gov/ofac/downloads/sdn.csv,
 * checked 2026-09-26), entry 27307 "LAZARUS GROUP", program DPRK3: "Digital
 * Currency Address - ETH 0x098B716B8Aaf21512996dC57EB0615e2383E2f96". Added
 * by OFAC on 2022-04-14 (https://ofac.treasury.gov/recent-actions/20220414).
 * Pinned here only to catch drift in the HTML; the harness itself reads the
 * value from site/spoofed-invoice.html, never from this constant.
 */
const OFAC_LAZARUS_ETH_ADDRESS_LOWER = '0x098b716b8aaf21512996dc57eb0615e2383e2f96';

describe('villain-corpus core BEC scenarios (real enforce(), no mocks)', () => {
  it('scenario 1: vnd-globex-freight fraudulent payout address -> HELD_FOR_STEPUP / PREMISE_HELD_FOR_REVIEW', async () => {
    const spec = await buildScenario1();
    const result = await runScenario(spec);

    expect(result.verdict.outcome).toBe(2);
    expect(result.verdict.reasonCode).toBe(ReasonCode.PREMISE_HELD_FOR_REVIEW);
    expect(result.pass).toBe(true);

    // The claimed value in the proposal really is the fraudulent address read
    // off the spoofed page, and it really differs from what the policy holds
    // as "the real value" for documentation (`value`, unused by evaluatePremise
    // but useful here as an independent cross-check).
    const claim = spec.proposal.premises[0];
    expect(claim).toBeDefined();
    expect(claim?.claimedValue).toBe(readFraudulentPayoutAddress());
    expect(claim?.claimedValue).not.toBe(spec.policy.premises[0]?.value);
  });

  it('scenario 2: vnd-suspended-corp status mismatch -> REFUSED / PREMISE_MISMATCH', async () => {
    const spec = await buildScenario2();
    const result = await runScenario(spec);

    expect(result.verdict.outcome).toBe(1);
    expect(result.verdict.reasonCode).toBe(ReasonCode.PREMISE_MISMATCH);
    expect(result.pass).toBe(true);
  });

  it('scenario 3: vnd-acme-supplies correct matching claim -> CLEARED / OK', async () => {
    const spec = await buildScenario3();
    const result = await runScenario(spec);

    expect(result.verdict.outcome).toBe(0);
    expect(result.verdict.reasonCode).toBe(ReasonCode.OK);
    expect(result.pass).toBe(true);
  });

  it('the fraudulent address embedded in the spoofed page is a well-formed, distinct 32-byte hex address', () => {
    const fraudulent = readFraudulentPayoutAddress();
    expect(fraudulent).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});

describe('claimed EVM identity on the spoofed invoice', () => {
  it('is parsed from the HTML, is a 20-byte lowercase EVM address, and is the OFAC-listed Lazarus Group address', () => {
    const claimed = readClaimedEvmIdentity();
    expect(claimed).toMatch(/^0x[0-9a-f]{40}$/);
    expect(claimed).toBe(OFAC_LAZARUS_ETH_ADDRESS_LOWER);
  });

  it('extractClaimedEvmIdentity throws if the markup drifts, rather than returning a stale value', () => {
    expect(() => extractClaimedEvmIdentity('<div id="something-else" data-address="0x00"></div>')).toThrow(
      /claimed-evm-identity/,
    );
  });

  it('the naive agent proposal carries both the claimed Sui payout address and the claimed EVM identity', () => {
    const naive = proposeNaivePayment('vnd-globex-freight', '8450000000');
    expect(naive.claimedPayoutAddress).toBe(readFraudulentPayoutAddress());
    expect(naive.claimedPayeeEvmAddress).toBe(readClaimedEvmIdentity());
  });
});

describe('key-gated Intercepta screen scenario (globex, full policy)', () => {
  it('orders the intercepta-risk screen BEFORE the holdOnMismatch payout premise, and the screen is a hard refuse', async () => {
    const spec = await buildInterceptaScreenScenario();
    const ids = spec.proposal.premises.map((p) => p.premiseId);
    expect(ids[0]).toBe(INTERCEPTA_SCREEN_PREMISE_ID);
    expect(ids.indexOf(INTERCEPTA_SCREEN_PREMISE_ID)).toBeLessThan(ids.indexOf('p-vendor-payout'));
    const screen = spec.policy.premises.find((p) => p.id === INTERCEPTA_SCREEN_PREMISE_ID);
    expect(screen).toMatchObject({
      schema: 'intercepta-risk',
      field: 'payment.payTo.traitCount',
      op: 'lte',
      value: '0',
      args: [readClaimedEvmIdentity()],
    });
    expect(screen?.holdOnMismatch).toBeUndefined();
    expect(spec.expected).toEqual({ outcome: 1, reasonCode: ReasonCode.PREMISE_MISMATCH });
  });

  it('with INTERCEPTA_API_KEY absent: reported "not run: missing key", never passing, and enforce() fails CLOSED (REFUSED / PREMISE_UNRESOLVABLE)', async () => {
    const saved = process.env['INTERCEPTA_API_KEY'];
    delete process.env['INTERCEPTA_API_KEY'];
    try {
      const result = await runInterceptaScreenScenario();
      expect(result.status).toBe('not_run_missing_key');
      expect(result.pass).toBe(false);
      expect(result.actual.outcome).toBe(1);
      expect(result.actual.reasonCode).toBe(ReasonCode.PREMISE_UNRESOLVABLE);
      expect(result.resolveFailures).toHaveLength(1);
      expect(result.resolveFailures[0]).toMatchObject({
        schema: 'intercepta-risk',
        field: 'payment.payTo.traitCount',
        errorName: 'InterceptaKeyMissingError',
      });
      // It refused on the screen, BEFORE the payout-address premise could turn
      // this into a human-approvable hold.
      expect(result.actual.reasonCode).not.toBe(ReasonCode.PREMISE_HELD_FOR_REVIEW);
    } finally {
      if (saved !== undefined) process.env['INTERCEPTA_API_KEY'] = saved;
    }
  });
});
