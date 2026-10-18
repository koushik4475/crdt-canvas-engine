module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        target: 'ES2022',
        module: 'CommonJS',
        esModuleInterop: true,
        skipLibCheck: true
      }
    }]
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  verbose: true
};
