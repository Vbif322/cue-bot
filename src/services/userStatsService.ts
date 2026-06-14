import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { matches, tournamentParticipants, tournaments } from '@/db/schema.js';

export interface UserMatchStats {
  played: number;
  wins: number;
  losses: number;
}

export async function getUserMatchStats(userId: UUID): Promise<UserMatchStats> {
  const rows = await db
    .select({
      played: sql<number>`COUNT(*)::int`,
      wins: sql<number>`SUM(CASE WHEN ${matches.winnerId} = ${userId} THEN 1 ELSE 0 END)::int`,
    })
    .from(matches)
    .where(
      and(
        eq(matches.status, 'completed'),
        or(eq(matches.player1Id, userId), eq(matches.player2Id, userId)),
      ),
    );

  const row = rows[0];
  const played = row?.played ?? 0;
  const wins = row?.wins ?? 0;
  return { played, wins, losses: played - wins };
}

export interface UserTournamentHistoryItem {
  id: UUID;
  name: string;
  completedAt: Date;
  isWinner: boolean;
}

export async function getUserCompletedTournaments(
  userId: UUID,
  limit = 5,
): Promise<UserTournamentHistoryItem[]> {
  const rows = await db
    .select({
      id: tournaments.id,
      name: tournaments.name,
      completedAt: tournaments.updatedAt,
    })
    .from(tournamentParticipants)
    .innerJoin(
      tournaments,
      eq(tournamentParticipants.tournamentId, tournaments.id),
    )
    .where(
      and(
        eq(tournamentParticipants.userId, userId),
        eq(tournamentParticipants.status, 'confirmed'),
        eq(tournaments.status, 'completed'),
      ),
    )
    .orderBy(desc(tournaments.updatedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const tournamentIds = rows.map((r) => r.id);
  const finishedMatches = await db
    .select({
      tournamentId: matches.tournamentId,
      winnerId: matches.winnerId,
    })
    .from(matches)
    .where(
      and(
        inArray(matches.tournamentId, tournamentIds),
        eq(matches.status, 'completed'),
      ),
    )
    .orderBy(desc(matches.round), desc(matches.position));

  const winnerByTournament = new Map<UUID, UUID | null>();
  for (const m of finishedMatches) {
    if (!winnerByTournament.has(m.tournamentId)) {
      winnerByTournament.set(m.tournamentId, m.winnerId ?? null);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    completedAt: r.completedAt,
    isWinner: winnerByTournament.get(r.id) === userId,
  }));
}
