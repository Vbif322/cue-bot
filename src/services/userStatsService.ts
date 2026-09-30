import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import {
  matchFrames,
  matches,
  tournamentParticipants,
  tournaments,
} from '@/db/schema.js';

export interface UserMatchStats {
  played: number;
  wins: number;
  losses: number;
  /** Frames (racks) from the match score; technical results excluded. */
  framesWon: number;
  framesLost: number;
  /** Snooker points from frame-by-frame reports; null when the user has none. */
  points: { won: number; lost: number } | null;
  /** Highest recorded break (snooker); null when none was captured. */
  maxBreak: number | null;
}

export async function getUserMatchStats(userId: UUID): Promise<UserMatchStats> {
  const userCompletedMatch = and(
    eq(matches.status, 'completed'),
    or(eq(matches.player1Id, userId), eq(matches.player2Id, userId)),
  );
  // Pick the user's side of a per-slot column pair.
  const own = (p1: unknown, p2: unknown) =>
    sql`CASE WHEN ${matches.player1Id} = ${userId} THEN ${p1} ELSE ${p2} END`;
  const nonTechnical = (expr: unknown) =>
    sql`CASE WHEN NOT ${matches.isTechnicalResult} THEN ${expr} END`;

  const [matchRows, frameRows] = await Promise.all([
    db
      .select({
        played: sql<number>`COUNT(*)::int`,
        wins: sql<number>`SUM(CASE WHEN ${matches.winnerId} = ${userId} THEN 1 ELSE 0 END)::int`,
        // sum(int4) is bigint, which node-postgres returns as a string — hence ::int.
        framesWon: sql<number>`COALESCE(SUM(${nonTechnical(own(matches.player1Score, matches.player2Score))}), 0)::int`,
        framesLost: sql<number>`COALESCE(SUM(${nonTechnical(own(matches.player2Score, matches.player1Score))}), 0)::int`,
      })
      .from(matches)
      .where(userCompletedMatch),
    // Frame rows of a scheduled/in_progress match are a draft; the `completed`
    // filter keeps them out. Technical results drop their frames, but guard anyway.
    db
      .select({
        frames: sql<number>`COUNT(*)::int`,
        pointsWon: sql<number>`COALESCE(SUM(${own(matchFrames.player1Points, matchFrames.player2Points)}), 0)::int`,
        pointsLost: sql<number>`COALESCE(SUM(${own(matchFrames.player2Points, matchFrames.player1Points)}), 0)::int`,
        maxBreak: sql<
          number | null
        >`MAX(${own(matchFrames.player1Break, matchFrames.player2Break)})`,
      })
      .from(matchFrames)
      .innerJoin(matches, eq(matchFrames.matchId, matches.id))
      .where(and(userCompletedMatch, eq(matches.isTechnicalResult, false))),
  ]);

  const m = matchRows[0];
  const f = frameRows[0];
  const played = m?.played ?? 0;
  const wins = m?.wins ?? 0;
  return {
    played,
    wins,
    losses: played - wins,
    framesWon: m?.framesWon ?? 0,
    framesLost: m?.framesLost ?? 0,
    points:
      f != null && f.frames > 0
        ? { won: f.pointsWon, lost: f.pointsLost }
        : null,
    maxBreak: f?.maxBreak ?? null,
  };
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
