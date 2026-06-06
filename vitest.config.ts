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
    },
  },
});
