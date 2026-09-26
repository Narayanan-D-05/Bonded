/** @type {import('ts-jest').JestConfigWithTsJest} */
// ts-jest runs transpile-only here (isolatedModules in tsconfig.json). Test files are
// type-checked separately by `tsc -p tsconfig.test.json` in the `test` script. Scoped to
// lib/ only — app/**/*.tsx (React components, route handlers) are exercised via the real
// dev server, not jest, per the task's own verification instructions.
module.exports = {
  extensionsToTreatAsEsm: ['.ts'],
  // RegExp source with properly escaped dots (same fix as packages/sui-settlement/jest.config.cjs):
  // the plain-string form collapses `\.` to `.`, which also matched @mysten/sui's internal `.mjs`
  // imports once this app started depending on @bonded/sui-settlement.
  moduleNameMapper: {
    [/^(\.{1,2}\/.*)\.js$/.source]: '$1',
  },
  transform: {
    '^.+\.ts$': ['ts-jest', { useESM: true }],
  },
  testEnvironment: 'node',
  testMatch: ['<rootDir>/lib/**/__tests__/**/*.test.ts'],
};
