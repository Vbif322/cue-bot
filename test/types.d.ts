import 'vitest';

declare module 'vitest' {
  interface ProvidedContext {
    /** Connection URI of the throwaway Postgres test container (Phase 0b). */
    dbUrl: string;
  }
}
