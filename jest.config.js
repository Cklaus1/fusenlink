/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  setupFiles: ['./tests/setup.js'],
  transform: {},
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'background.js',
    'invitations.js',
    'search.js',
    'lib/**/*.js'
  ],
  moduleFileExtensions: ['js'],
  verbose: true
};