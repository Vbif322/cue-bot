import type { UUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { matches, matchFrames } from '@/db/schema.js';
import { getTournamentMatches } from './matchService.js';
import { getConfirmedParticipantsBySeed } from './tournamentService.js';
import {
  computeAllStandings,
  type GroupStanding,
  type StandingMatch,
  type StandingMember,
} from './standingsService.js';

/**
 * DB-facing wrapper around the pure standings logic: load the group-phase matches,
 * derive each group's members (with their seed) from the match rows, and compute
 * standings. Returns [] if the group phase hasn't been generated yet.
 */
export async function getGroupStandings(
  tournamentId: UUID,
): Promise<GroupStanding[]> {
  const allMatches = await getTournamentMatches(tournamentId);
  const groupMatches = allMatches.filter((m) => m.phase === 'group');
  if (groupMatches.length === 0) return [];

  const [participants, pointsByMatch] = await Promise.all([
    getConfirmedParticipantsBySeed(tournamentId),
    getGroupFramePoints(tournamentId),
  ]);
  const seedById = new Map<UUID, number | null>(
    participants.map((p) => [p.userId, p.seed]),
  );

  const groupsCount =
    Math.max(...groupMatches.map((m) => m.groupIndex ?? 0)) + 1;

  const membersByGroup: StandingMember[][] = [];
  const matchesByGroup: StandingMatch[][] = [];

  for (let g = 0; g < groupsCount; g++) {
    const gMatches = groupMatches.filter((m) => m.groupIndex === g);
    const memberIds = new Set<UUID>();
    for (const m of gMatches) {
      if (m.player1Id) memberIds.add(m.player1Id);
      if (m.player2Id) memberIds.add(m.player2Id);
    }
    membersByGroup[g] = [...memberIds].map((userId) => ({
      userId,
      seed: seedById.get(userId) ?? null,
    }));
    matchesByGroup[g] = gMatches.map((m) => {
      const pts = pointsByMatch.get(m.id);
      return {
        player1Id: m.player1Id,
        player2Id: m.player2Id,
        winnerId: m.winnerId,
        player1Score: m.player1Score,
        player2Score: m.player2Score,
        status: m.status,
        player1Points: pts?.player1Points ?? null,
        player2Points: pts?.player2Points ?? null,
      };
    });
  }

  return computeAllStandings(membersByGroup, matchesByGroup);
}

export interface MatchFramePoints {
  player1Points: number;
  player2Points: number;
}

/**
 * Per-match sums of frame points across the tournament's group phase (snooker).
 * Only matches that actually have frame rows appear in the map — an absent key is
 * the signal that the match has no per-frame breakdown (non-snooker, aggregate
 * report, walkover/technical, or an admin correction, which deletes the frames).
 *
 * No status filter: `computeGroupStanding` only counts completed matches, so rows
 * for a still-pending match are inert.
 */
export async function getGroupFramePoints(
  tournamentId: UUID,
): Promise<Map<UUID, MatchFramePoints>> {
  const rows = await db
    .select({
      matchId: matchFrames.matchId,
      // sum(int4) is bigint in Postgres, which node-postgres hands back as a
      // string — the ::int cast is what makes the `sql<number>` annotation true.
      player1Points: sql<number>`sum(${matchFrames.player1Points})::int`,
      player2Points: sql<number>`sum(${matchFrames.player2Points})::int`,
    })
    .from(matchFrames)
    .innerJoin(matches, eq(matchFrames.matchId, matches.id))
    .where(
      and(eq(matches.tournamentId, tournamentId), eq(matches.phase, 'group')),
    )
    .groupBy(matchFrames.matchId);

  return new Map(
    rows.map((r) => [
      r.matchId,
      { player1Points: r.player1Points, player2Points: r.player2Points },
    ]),
  );
}

/**
 * Highest break each player recorded across the tournament's group-phase frames
 * (snooker). Returns an empty map when no breaks were captured. Break values are
 * per-slot: `player1Break` belongs to the frame's `player1Id`, `player2Break` to
 * its `player2Id`.
 */
export async function getGroupMaxBreaks(
  tournamentId: UUID,
): Promise<Map<UUID, number>> {
  const rows = await db
    .select({
      player1Id: matches.player1Id,
      player2Id: matches.player2Id,
      player1Break: matchFrames.player1Break,
      player2Break: matchFrames.player2Break,
    })
    .from(matchFrames)
    .innerJoin(matches, eq(matchFrames.matchId, matches.id))
    .where(
      and(eq(matches.tournamentId, tournamentId), eq(matches.phase, 'group')),
    );

  const maxBreakById = new Map<UUID, number>();
  const record = (userId: UUID | null, value: number | null): void => {
    if (userId == null || value == null) return;
    const prev = maxBreakById.get(userId);
    if (prev == null || value > prev) maxBreakById.set(userId, value);
  };
  for (const r of rows) {
    record(r.player1Id, r.player1Break);
    record(r.player2Id, r.player2Break);
  }
  return maxBreakById;
}
