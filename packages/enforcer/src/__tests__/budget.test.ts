import { isBudgetExceeded, isIrreversible } from '../budget.js';

describe('isBudgetExceeded', () => {
  it('exactly equal to max is not exceeded', () => {
    expect(isBudgetExceeded(90_000_000n, 10_000_000n, 100_000_000n)).toBe(false);
  });

  it('one unit over max is exceeded', () => {
    expect(isBudgetExceeded(90_000_001n, 10_000_000n, 100_000_000n)).toBe(true);
  });

  it('zero spent so far, requested under max is not exceeded', () => {
    expect(isBudgetExceeded(0n, 99_999_999n, 100_000_000n)).toBe(false);
  });
});

describe('isIrreversible', () => {
  it('exactly equal to the threshold does NOT hold (strict >)', () => {
    expect(isIrreversible(50_000_000n, 50_000_000n)).toBe(false);
  });

  it('one unit above the threshold holds', () => {
    expect(isIrreversible(50_000_001n, 50_000_000n)).toBe(true);
  });

  it('zero is never irreversible against a positive threshold', () => {
    expect(isIrreversible(0n, 50_000_000n)).toBe(false);
  });
});
