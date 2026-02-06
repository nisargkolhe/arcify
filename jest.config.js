export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/e2e/**/*.test.js'],
  testTimeout: 60000, // Increased to 60 seconds for browser-based tests
  verbose: true,
  bail: false,
  collectCoverage: false,
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/setup.js'],
  globalSetup: '<rootDir>/tests/e2e/global-setup.js',
  globalTeardown: '<rootDir>/tests/e2e/global-teardown.js',
  transform: {},
  moduleFileExtensions: ['js', 'json'],
};
