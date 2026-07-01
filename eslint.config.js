import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignore everything outside the typed src/test project: build output, the separate
  // admin SPA, generated/working dirs, and root config files not covered by tsconfig.
  {
    ignores: [
      'build/**',
      'admin/**', // separate Vite/React project with its own toolchain
      'packages/**', // shared UI package (@cue-bot/ui) with its own React/Vite toolchain
      'drizzle/**',
      'coverage/**',
      'temp/**',
      'audit/**',
      'eslint.config.js',
      '*.config.ts', // vitest.config.ts, drizzle.config.ts
      'scripts/**', // .ts seed scripts not covered by the root tsconfig
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Type-aware linting needs project info; scope it to the files tsconfig includes.
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
