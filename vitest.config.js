import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The release and bundle suites spawn git and child CLIs; under a full
    // parallel run they exceed vitest's 5s default.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // Measure spawned bin/* and helper CLIs too.
      autoAttachSubprocess: true,
      include: ['src/**/*.js', 'bin/**/*.js'],
      exclude: ['**/*.d.ts'],
      reporter: ['text-summary'],
      // Floor to ratchet up as coverage grows, not a target.
      thresholds: { statements: 78, branches: 69, functions: 73, lines: 78 },
    },
  },
});
