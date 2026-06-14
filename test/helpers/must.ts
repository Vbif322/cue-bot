import type { UUID } from 'crypto';

import type { MatchWithPlayers } from '@/bot/@types/match.js';
import { getTournamentMatches } from '@/services/matchService.js';

/**
 * Narrow away null/undefined or throw — the lint config forbids `!`, and tests
 * want a loud failure (not a silent `undefined`) when an expected value is absent.
 */
export function must<T>(value: T | null | undefined, label = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

/**
 * Return an accessor over a tournament's matches keyed by bracket position.
 * `pos(n)` throws if no match sits at position `n`. Re-fetch between mutations.
 */
export async function positionLookup(
  tournamentId: UUID,
): Promise<(position: number) => MatchWithPlayers> {
  const all = await getTournamentMatches(tournamentId);
  const map = new Map(all.map((m) => [m.position, m]));
  return (position: number) =>
    must(map.get(position), `match at position ${String(position)}`);
}
