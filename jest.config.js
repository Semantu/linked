/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src/tests',
  testMatch: [
    '**/query.test.ts',
    '**/query.types.test.ts',
    '**/intermediate-representation.types.test.ts',
    '**/metadata.test.ts',
    '**/store-routing.test.ts',
    '**/core-utils.test.ts',
    '**/ir-desugar.test.ts',
    '**/ir-canonicalize.test.ts',
    '**/ir-alias-scope.test.ts',
    '**/ir-projection.test.ts',
    '**/ir-pipeline-parity.test.ts',
    '**/ir-select-golden.test.ts',
    '**/ir-mutation-parity.test.ts',
  ],
  testPathIgnorePatterns: ['/old/'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/../../tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
