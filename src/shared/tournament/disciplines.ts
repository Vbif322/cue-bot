// Single source of truth for the two-level sport → discipline model.
// Shared layer: imported by the Drizzle schema and services directly, and by the
// React SPA via the `@server/apiTypes` re-export. Keep this file dependency-free
// so it stays safe to bundle into the client.

import type { ITournamentWinScore } from './tournamentOptions.js';

export const sports = ['snooker', 'pool', 'russian_billiards'] as const;

export type ITournamentSport = (typeof sports)[number];

// Every discipline across all sports; the flat set backs the DB check constraint.
// Which disciplines belong to which sport is expressed by SPORT_DISCIPLINES —
// enforce the pairing at the application layer (a varchar enum can't).
export const disciplines = [
  'snooker_15_red',
  'snooker_10_red',
  'snooker_6_red',
  'pool_8',
  'pool_9',
  'pool_10',
  'russian_free',
  'russian_combined',
  'russian_dynamic',
] as const;

export type ITournamentDiscipline = (typeof disciplines)[number];

export const SPORT_DISCIPLINES: Record<
  ITournamentSport,
  readonly ITournamentDiscipline[]
> = {
  snooker: ['snooker_15_red', 'snooker_10_red', 'snooker_6_red'],
  pool: ['pool_8', 'pool_9', 'pool_10'],
  russian_billiards: ['russian_free', 'russian_combined', 'russian_dynamic'],
};

/** The sport a discipline belongs to. */
export function sportOfDiscipline(
  discipline: ITournamentDiscipline,
): ITournamentSport {
  for (const sport of sports) {
    if (SPORT_DISCIPLINES[sport].includes(discipline)) return sport;
  }
  // Unreachable: every discipline is listed in SPORT_DISCIPLINES.
  throw new Error(`Дисциплина без вида: ${discipline as string}`);
}

/**
 * Validate that a discipline belongs to a sport. Returns a Russian error string
 * or null if valid. Shared by the bot wizard, the admin zod schema and the
 * tournament service.
 */
export function validateSportDiscipline(
  sport: ITournamentSport,
  discipline: ITournamentDiscipline,
): string | null {
  return SPORT_DISCIPLINES[sport].includes(discipline)
    ? null
    : 'Дисциплина не относится к выбранному виду бильярда';
}

// Suggested race-to (winScore) default per discipline: long frames → shorter
// matches. Creation UIs use this as the preselected value; the user can override.
export const DEFAULT_WIN_SCORE_BY_DISCIPLINE: Record<
  ITournamentDiscipline,
  ITournamentWinScore
> = {
  snooker_15_red: 2,
  snooker_10_red: 3,
  snooker_6_red: 3,
  pool_8: 4,
  pool_9: 5,
  pool_10: 4,
  russian_free: 3,
  russian_combined: 3,
  russian_dynamic: 3,
};
