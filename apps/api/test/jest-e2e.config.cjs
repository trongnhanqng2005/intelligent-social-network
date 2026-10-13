module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/jest-e2e.setup.cjs'],
  globalSetup: '<rootDir>/test/jest-e2e.global-setup.cjs',
  globalTeardown: '<rootDir>/test/jest-e2e.teardown.cjs',
  clearMocks: true,
};
