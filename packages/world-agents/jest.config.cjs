/** @type {import('ts-jest').JestConfigWithTsJest} */
// Same pattern as packages/seam and the old identity/: ts-jest is transpile-only;
// tsconfig.test.json type-checks the test files separately (the `test` script runs both).
module.exports = {
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true }] },
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testTimeout: 20_000,
};
