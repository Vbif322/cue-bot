import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config.
 *
 * Tests are split into projects with different environments (Phase 0a ships
 * only `unit`; `integration` / `e2e-bot` are added in Phase 0b once the
 * Postgres test harness exists).
 *
 * The codebase uses the `@/*` path alias (tsconfig: `@/* -> src/*`) and
 * NodeNext-style `.js` import specifiers that point at `.ts` source files.
 * The explicit alias below resolves `@/`; Vite resolves the `.js` -> `.ts`
 * mapping natively.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          globals: true,
          include: ['test/unit/**/*.test.ts'],
          setupFiles: ['./test/setup/unit.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          include: ['test/integration/**/*.test.ts'],
          // globalSetup lives on the project (not root) so `--project unit`
          // never starts Docker.
          globalSetup: ['./test/setup/db.globalSetup.ts'],
          setupFiles: ['./test/setup/db.setupFile.ts'],
          // One shared DB → serialize so tests don't truncate each other's data.
          fileParallelism: false,
          hookTimeout: 120_000, // container start + first-time image pull
          testTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'html'],
      // Coverage is measured across BOTH projects (unit + integration); run via
      // `npm run test:coverage`. Thresholds guard against regression, not a goal
      // to reach — `include: src/**` counts 0%-covered handlers/wizards, so the
      // global floor sits well below the current ~42% with a buffer to avoid
      // failing unrelated PRs. Per-file floors lock in the critical, well-covered
      // services (rounded down from their real coverage with margin).
      thresholds: {
        lines: 38,
        statements: 38,
        functions: 42,
        branches: 36,
        'src/services/matchService.ts': {
          lines: 75,
          statements: 70,
          functions: 68,
          branches: 68,
        },
        'src/services/tournamentService.ts': {
          lines: 78,
          statements: 73,
          functions: 78,
          branches: 70,
        },
        'src/services/bracketGenerator.ts': {
          lines: 85,
          statements: 80,
          functions: 88,
          branches: 72,
        },
        'src/services/randomBracketAdvancement.ts': {
          lines: 88,
          statements: 85,
          functions: 90,
          branches: 85,
        },
      },
    },
  },
});
