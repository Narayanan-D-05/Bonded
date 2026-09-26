/** @type {import('ts-jest').JestConfigWithTsJest} */
// Same pattern as packages/seam: ts-jest is transpile-only; tsconfig.test.json type-checks tests.
module.exports = {
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true }] },
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
};
