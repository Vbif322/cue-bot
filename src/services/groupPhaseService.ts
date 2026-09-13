import type { UUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { matches, matchFrames } from '@/db/schema.js';
import type { MatchPhase } from '@/db/schema/matches.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import type { ITournamentFormat } from '@/shared/tournament/formats.js';
import { getTournamentMatches } from './matchService.js';
import { getConfirmedParticipantsBySeed } from './tournamentService.js';
import {
  computeAllStandings,
  computeGroupStanding,
  type GroupStanding,
  type StandingMatch,
  type StandingMember,
} from './standingsService.js';

/** Shape a match row + its frame points into the pure layer's input. */
function toStandingMatch(
  m: MatchWithPlayers,
  pointsByMatch: Map<UUID, MatchFramePoints>,
): StandingMatch {
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
}

/**
 * Standings for whatever format the tournament uses: per-group tables for
 * `groups_playoff`, a single table (groupIndex 0) for `round_robin`, and `[]` for
 * the elimination formats, which have a bracket instead. Single entry point — every
 * consumer (bracket read-model, app + admin `/standings` routes) goes through here
 * so the formats cannot drift apart again.
 */
export async function getStandings(
  tournamentId: UUID,
  format: ITournamentFormat,
): Promise<GroupStanding[]> {
  if (format === 'groups_playoff') return await getGroupStandings(tournamentId);
  if (format === 'round_robin')
    return await getRoundRobinStandings(tournamentId);
  return [];
}

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
    matchesByGroup[g] = gMatches.map((m) => toStandingMatch(m, pointsByMatch));
  }

  return computeAllStandings(membersByGroup, matchesByGroup);
}

/**
 * Standings of a pure round-robin tournament: structurally a single group with no
 * group tag, so the same pure logic applies with `groupIndex` 0.
 *
 * Two differences from the group phase. Every match of the tournament belongs to the
 * table (round-robin rows carry the default `phase: 'playoff'`/`groupIndex: null`, so
 * there is nothing to filter by), and the members come from the confirmed participant
 * list rather than from the match rows — the table is then visible right after the
 * start, everyone on zeroes, and a participant who somehow has no match still shows up.
 */
export async function getRoundRobinStandings(
  tournamentId: UUID,
): Promise<GroupStanding[]> {
  const [allMatches, participants, pointsByMatch] = await Promise.all([
    getTournamentMatches(tournamentId),
    getConfirmedParticipantsBySeed(tournamentId),
    getGroupFramePoints(tournamentId, null),
  ]);
  if (participants.length === 0) return [];

  const members: StandingMember[] = participants.map((p) => ({
    userId: p.userId,
    seed: p.seed,
  }));
  const standingMatches = allMatches.map((m) =>
    toStandingMatch(m, pointsByMatch),
  );

  return [computeGroupStanding(0, members, standingMatches)];
}

export interface MatchFramePoints {
  player1Points: number;
  player2Points: number;
}

/** Restrict a frame query to one tournament, and to one match phase unless null. */
function phaseScope(tournamentId: UUID, phase: MatchPhase | null) {
  return phase == null
    ? eq(matches.tournamentId, tournamentId)
    : and(eq(matches.tournamentId, tournamentId), eq(matches.phase, phase));
}

/**
 * Per-match sums of frame points (snooker), by default across the tournament's group
 * phase; pass `phase: null` for formats where every match counts (round-robin).
 * Only matches that actually have frame rows appear in the map — an absent key is
 * the signal that the match has no per-frame breakdown (non-snooker, aggregate
 * report, walkover/technical, or an admin correction, which deletes the frames).
 *
 * No status filter: `computeGroupStanding` only counts completed matches, so rows
 * for a still-pending match are inert.
 */
export async function getGroupFramePoints(
  tournamentId: UUID,
  phase: MatchPhase | null = 'group',
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
    .where(phaseScope(tournamentId, phase))
    .groupBy(matchFrames.matchId);

  return new Map(
    rows.map((r) => [
      r.matchId,
      { player1Points: r.player1Points, player2Points: r.player2Points },
    ]),
  );
}

/**
 * Highest break each player recorded across the tournament's frames (snooker),
 * by default group-phase only; pass `phase: null` for round-robin, where every match
 * counts. Returns an empty map when no breaks were captured. Break values are
 * per-slot: `player1Break` belongs to the frame's `player1Id`, `player2Break` to
 * its `player2Id`.
 */
export async function getGroupMaxBreaks(
  tournamentId: UUID,
  phase: MatchPhase | null = 'group',
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
    .where(phaseScope(tournamentId, phase));

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
