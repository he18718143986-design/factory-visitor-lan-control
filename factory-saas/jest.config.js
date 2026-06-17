'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'utils/**/*.js',
    'middleware/**/*.js',
    'sessions/serialize.js',
    'config/index.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  testTimeout: 10000,
};
