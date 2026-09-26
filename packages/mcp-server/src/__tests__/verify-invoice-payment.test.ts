/**
 * Calls the `verifyInvoicePayment` handler DIRECTLY — never over stdio, never
 * through a real MCP client — against the three canonical BEC/AP scenarios
 * this package's task brief names, using `@bonded/issuer-oracle`'s REAL
 * seeded `vendor-fixture.ts` records (read directly from that file, not
 * guessed):
 *
 *   - `vnd-acme-supplies`  — payoutAddress
 *     '0x4d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e6b7885929facb9c6d3e0',
 *     invoiceAmountUSD '1250000000' ($1,250.00), status 'active'.
 *   - `vnd-globex-freight` — payoutAddress
 *     '0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e',
 *     invoiceAmountUSD '8450000000' ($8,450.00), status 'active'.
 *   - `vnd-suspended-corp` — payoutAddress
 *     '0x73808d9aa7b4c1cedbe8f5020f1c293643505d6a7784919eabb8c5d2dfecf906',
 *     invoiceAmountUSD '4200000000' ($4,200.00), status 'suspended'.
 *
 * No network call, no mock of `@bonded/issuer-oracle`/`@bonded/enforcer`/
 * `@bonded/dispatcher` — this is the real `enforce()` decision loop resolving
 * real fixture data, exactly like `packages/dispatcher/src/__tests__/
 * dispatcher.test.ts`'s own "real end-to-end, no mocks" block.
 */
import { ReasonCode } from '@bonded/seam';
import { verifyInvoicePayment, type VerifyInvoicePaymentInput } from '../tools/verify-invoice-payment.js';

const AGENT = '0x1111111111111111111111111111111111111111';

// Real seeded truth, copied verbatim from packages/issuer-oracle/src/vendor-fixture.ts.
const GLOBEX_REAL_PAYOUT_ADDRESS = '0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e';
const GLOBEX_REAL_INVOICE_AMOUNT_USD = '8450000000';
const SUSPENDED_REAL_PAYOUT_ADDRESS = '0x73808d9aa7b4c1cedbe8f5020f1c293643505d6a7784919eabb8c5d2dfecf906';
const SUSPENDED_REAL_INVOICE_AMOUNT_USD = '4200000000';
const ACME_REAL_PAYOUT_ADDRESS = '0x4d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e6b7885929facb9c6d3e0';
const ACME_REAL_INVOICE_AMOUNT_USD = '1250000000';

function makeInput(overrides: Partial<VerifyInvoicePaymentInput>): VerifyInvoicePaymentInput {
  return {
    vendorId: 'vnd-acme-supplies',
    claimedPayoutAddress: ACME_REAL_PAYOUT_ADDRESS,
    claimedInvoiceAmountUSD: ACME_REAL_INVOICE_AMOUNT_USD,
    agent: AGENT,
    ...overrides,
  };
}

describe('verifyInvoicePayment', () => {
  it('vnd-globex-freight with a claimed payout address that does NOT match the real one on file -> HELD_FOR_STEPUP / PREMISE_HELD_FOR_REVIEW', async () => {
    const FRAUDULENT_ADDRESS = '0xdeadbeef000000000000000000000000000000000000000000000000000dead';
    const result = await verifyInvoicePayment(
      makeInput({
        vendorId: 'vnd-globex-freight',
        claimedPayoutAddress: FRAUDULENT_ADDRESS,
        claimedInvoiceAmountUSD: GLOBEX_REAL_INVOICE_AMOUNT_USD,
      }),
    );

    expect(result.verdict.outcome).toBe(2);
    expect(result.verdict.outcomeLabel).toBe('HELD_FOR_STEPUP');
    expect(result.verdict.reasonCode).toBe(ReasonCode.PREMISE_HELD_FOR_REVIEW);
    expect(result.verdict.reasonCodeLabel).toBe('PREMISE_HELD_FOR_REVIEW');

    // The mismatch evidence is attached to the call, never a bare claim
    // (CLAUDE.md rule 5): the claimed (fraudulent) address and the real
    // derived address on file must both be present.
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toEqual({
      premiseId: 'vendor-payout-address',
      field: 'vendor.payoutAddress',
      claimedValue: FRAUDULENT_ADDRESS,
      derivedValue: GLOBEX_REAL_PAYOUT_ADDRESS,
    });
  });

  it('vnd-suspended-corp -> REFUSED / PREMISE_MISMATCH regardless of a correct claimed address and amount', async () => {
    const result = await verifyInvoicePayment(
      makeInput({
        vendorId: 'vnd-suspended-corp',
        claimedPayoutAddress: SUSPENDED_REAL_PAYOUT_ADDRESS,
        claimedInvoiceAmountUSD: SUSPENDED_REAL_INVOICE_AMOUNT_USD,
      }),
    );

    expect(result.verdict.outcome).toBe(1);
    expect(result.verdict.outcomeLabel).toBe('REFUSED');
    expect(result.verdict.reasonCode).toBe(ReasonCode.PREMISE_MISMATCH);
    expect(result.verdict.reasonCodeLabel).toBe('PREMISE_MISMATCH');

    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toEqual({
      premiseId: 'vendor-status-active',
      field: 'vendor.status',
      claimedValue: 'active',
      derivedValue: 'suspended',
    });
  });

  it('vnd-acme-supplies with a correct claim -> CLEARED / OK', async () => {
    const result = await verifyInvoicePayment(
      makeInput({
        vendorId: 'vnd-acme-supplies',
        claimedPayoutAddress: ACME_REAL_PAYOUT_ADDRESS,
        claimedInvoiceAmountUSD: ACME_REAL_INVOICE_AMOUNT_USD,
      }),
    );

    expect(result.verdict.outcome).toBe(0);
    expect(result.verdict.outcomeLabel).toBe('CLEARED');
    expect(result.verdict.reasonCode).toBe(ReasonCode.OK);
    expect(result.verdict.reasonCodeLabel).toBe('OK');
    expect(result.mismatches).toHaveLength(0);
  });

  it('rejects a non-0x-hex claimedPayoutAddress before ever calling enforce()', async () => {
    await expect(
      verifyInvoicePayment(makeInput({ claimedPayoutAddress: 'not-an-address' })),
    ).rejects.toThrow();
  });

  it('rejects a decimal (non-base-unit) claimedInvoiceAmountUSD', async () => {
    await expect(
      verifyInvoicePayment(makeInput({ claimedInvoiceAmountUSD: '1250.00' })),
    ).rejects.toThrow();
  });

  it('an unknown vendorId resolves PREMISE_UNRESOLVABLE (REFUSED), not a bare miss', async () => {
    const result = await verifyInvoicePayment(makeInput({ vendorId: 'vnd-does-not-exist' }));
    expect(result.verdict.outcome).toBe(1);
    expect(result.verdict.reasonCode).toBe(ReasonCode.PREMISE_UNRESOLVABLE);
  });
});
