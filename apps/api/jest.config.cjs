module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts', '**/*.integration-spec.ts'],
  clearMocks: true,
  testTimeout: 15000,
  collectCoverageFrom: [
    'src/**/application/**/*.ts',
    'src/**/domain/**/*.ts',
    'src/common/idempotency/**/*.ts',
  ],
  coverageReporters: ['json', 'lcov', 'text-summary'],
  coverageDirectory: 'coverage',
};
