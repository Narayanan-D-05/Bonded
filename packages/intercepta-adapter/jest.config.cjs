/** @type {import('ts-jest').JestConfigWithTsJest} */
// ts-jest runs transpile-only here (isolatedModules in tsconfig.json). Test files
// are type-checked separately by `tsc -p tsconfig.test.json` in the `test` script.
module.exports = {
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\.{1,2}/.*)\.js$': '$1',
  },
  transform: {
    '^.+\.ts$': ['ts-jest', { useESM: true }],
  },
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
};
