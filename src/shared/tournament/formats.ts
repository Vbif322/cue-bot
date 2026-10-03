// Single source of truth for tournament format identifiers.
// Shared layer: imported by the Drizzle schema and services directly, and by the
// React SPA via the `@server/apiTypes` re-export. Keep this file dependency-free
// so it stays safe to bundle into the client.

export const formats = [
  'single_elimination',
  'double_elimination',
  'round_robin',
  'groups_playoff',
] as const;

export type ITournamentFormat = (typeof formats)[number];

/**
 * Random pairing after each round only exists for pure elimination brackets.
 * Round-robin and groups_playoff advance by standings, and the random
 * advancement path would treat their matches as bracket rounds.
 */
export function supportsRandomAdvancement(format: ITournamentFormat): boolean {
  return format === 'single_elimination' || format === 'double_elimination';
}
