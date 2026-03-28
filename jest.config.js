/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src/tests'],
  testMatch: ['<rootDir>/src/tests/*.test.ts'],
  testPathIgnorePatterns: ['/old/'],
  globalSetup: '<rootDir>/src/tests/global-setup.ts',
  globalTeardown: '<rootDir>/src/tests/global-teardown.ts',
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
