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
import { buildScenario1, buildScenario2, buildScenario3, runScenario } from '../run.js';
import { readFraudulentPayoutAddress } from '../naive-ap-agent.js';

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
