import { describe, expect, it } from 'vitest';

/**
 * Phase 0a smoke test.
 *
 * Verifies the runner works AND — critically — that importing a db-coupled
 * service does NOT crash under the unit project. matchService transitively
 * imports src/db/db.ts, which throws at module load without DATABASE_URL;
 * the dummy URL in test/setup/unit.setup.ts must keep this import alive.
 */
describe('phase 0a smoke', () => {
  it('runs the vitest runner', () => {
    expect(1 + 1).toBe(2);
  });

  it('imports a db-coupled service without connecting', async () => {
    const matchService = await import('@/services/matchService.js');
    expect(typeof matchService.reportResult).toBe('function');
  });

  it('imports a pure service module', async () => {
    const bracket = await import('@/services/bracketGenerator.js');
    expect(bracket.getNextPowerOfTwo(5)).toBe(8);
  });
});
