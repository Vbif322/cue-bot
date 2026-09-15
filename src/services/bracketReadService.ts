import { eq, inArray } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { tournaments, users } from '@/db/schema.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';

import { getTournamentMatches, getMatchStats } from './matchService.js';
import { calculateRounds, getNextPowerOfTwo } from './bracketGenerator.js';
import { getStandings } from './groupPhaseService.js';
import type { GroupStanding } from './standingsService.js';

/** Player display fields keyed by user id in a bracket read-model. */
export interface BracketPlayer {
  username: string | null;
  name: string | null;
  surname: string | null;
  telegramId: string | null;
}

/**
 * Everything the bracket view needs, gathered in one place: the tournament, its
 * matches (with embedded player fields), completion stats, a player-id → name
 * map, the computed total round count, and standings (per-group for
 * `groups_playoff`, a single table for `round_robin`, empty for the elimination
 * formats, which have a bracket instead). Pure transformation/formatting lives in
 * `src/bot/ui/bracketUI.ts`; this service only fetches and assembles the data.
 */
export interface BracketReadModel {
  tournament: typeof tournaments.$inferSelect;
  matches: MatchWithPlayers[];
  stats: Awaited<ReturnType<typeof getMatchStats>>;
  playerMap: Map<string, BracketPlayer>;
  totalRounds: number;
  standings: GroupStanding[];
}

/**
 * Build the bracket read-model for a tournament. Returns `null` if the
 * tournament does not exist (the caller does the access check). A tournament
 * with no matches yet returns a model with `matches: []`.
 */
export async function getBracketReadModel(
  tournamentId: UUID,
): Promise<BracketReadModel | null> {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });
  if (!tournament) return null;

  const matchRows = await getTournamentMatches(tournamentId);
  const stats = await getMatchStats(tournamentId);

  const standings = await getStandings(tournamentId, tournament.format);

  const playerIds = new Set<UUID>();
  for (const match of matchRows) {
    if (match.player1Id) playerIds.add(match.player1Id);
    if (match.player2Id) playerIds.add(match.player2Id);
  }
  const bracketSize = getNextPowerOfTwo(playerIds.size);
  const totalRounds =
    tournament.format === 'double_elimination'
      ? calculateRounds(bracketSize) + 1
      : calculateRounds(bracketSize);

  // A standings row can name a participant who has no match row yet (round-robin
  // lists every confirmed participant from the start) — they need a name too, but
  // they must not inflate the bracket size above.
  for (const group of standings) {
    for (const row of group.rows) playerIds.add(row.userId);
  }

  const playerMap = new Map<string, BracketPlayer>();
  if (playerIds.size > 0) {
    const players = await db.query.users.findMany({
      where: inArray(users.id, Array.from(playerIds)),
    });
    for (const p of players) {
      playerMap.set(p.id, {
        username: p.username,
        name: p.name,
        surname: p.surname,
        telegramId: p.telegram_id,
      });
    }
  }

  return {
    tournament,
    matches: matchRows,
    stats,
    playerMap,
    totalRounds,
    standings,
  };
}
