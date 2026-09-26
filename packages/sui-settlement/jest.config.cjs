/** @type {import('ts-jest').JestConfigWithTsJest} */
// ts-jest runs transpile-only here (isolatedModules in tsconfig.json). Test files
// are type-checked separately by `tsc -p tsconfig.test.json` in the `test` script,
// so `@ts-expect-error` guards (a number where a bigint is required) are enforced.
//
// The mapper regex is written as a RegExp source with properly escaped dots. The
// template copied from packages/dispatcher writes '^(\.{1,2}/.*)\.js$' in a plain
// JS string, where `\.` collapses to `.`. That also matches `./x.mjs` and broke
// @mysten/sui's own internal `.mjs` imports.
module.exports = {
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    [/^(\.{1,2}\/.*)\.js$/.source]: '$1',
  },
  transform: {
    [/^.+\.ts$/.source]: ['ts-jest', { useESM: true }],
  },
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
};
