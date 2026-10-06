import type { UUID } from 'crypto';

import type { ITournamentFormat } from '@/shared/tournament/formats.js';
import type { IPlacementGroup } from '@/shared/tournament/prizes.js';
import { getTournamentMatches } from './matchService.js';
import { getStandings } from './groupPhaseService.js';
import type { GroupStanding } from './standingsService.js';

// Final places of a finished tournament. The pure part (computeFinalPlacements)
// works on plain match/standing lists so it is unit-testable; the DB wrapper is
// getFinalPlacements.

export interface PlacementMatch {
  round: number;
  bracketType: string | null;
  phase: 'group' | 'playoff';
  status: string;
  player1Id: UUID | null;
  player2Id: UUID | null;
  winnerId: UUID | null;
}

export type PlacementGroup = IPlacementGroup<UUID>;

/**
 * Rank the players of an elimination bracket. Every player but the champion has
 * exactly one eliminating loss; `eliminationKey` orders those losses (a later
 * exit scores higher). Players who went out at the same key share a place range,
 * e.g. both losing semifinalists get 3–4.
 */
function rankElimination(
  bracketMatches: PlacementMatch[],
  isEliminating: (m: PlacementMatch) => boolean,
  eliminationKey: (m: PlacementMatch) => number,
): PlacementGroup[] {
  const completed = bracketMatches.filter(
    (m) => m.status === 'completed' && m.winnerId !== null,
  );

  const players = new Set<UUID>();
  const keyByLoser = new Map<UUID, number>();
  for (const m of completed) {
    if (m.player1Id) players.add(m.player1Id);
    if (m.player2Id) players.add(m.player2Id);
    // A walkover (empty seat) is not a loss of anyone.
    if (!m.player1Id || !m.player2Id || !isEliminating(m)) continue;
    const loser = m.winnerId === m.player1Id ? m.player2Id : m.player1Id;
    keyByLoser.set(loser, eliminationKey(m));
  }

  const survivors = [...players].filter((id) => !keyByLoser.has(id));
  const [champion] = survivors;
  if (champion === undefined || survivors.length !== 1) {
    throw new Error('Не удалось определить победителя: сетка не доиграна');
  }

  const byKey = new Map<number, UUID[]>();
  for (const [userId, key] of keyByLoser) {
    const list = byKey.get(key) ?? [];
    list.push(userId);
    byKey.set(key, list);
  }

  const groups: PlacementGroup[] = [
    { placeFrom: 1, placeTo: 1, userIds: [champion] },
  ];
  let next = 2;
  for (const key of [...byKey.keys()].sort((a, b) => b - a)) {
    const userIds = byKey.get(key) ?? [];
    groups.push({
      placeFrom: next,
      placeTo: next + userIds.length - 1,
      userIds,
    });
    next += userIds.length;
  }
  return groups;
}

function rankSingleElimination(
  bracketMatches: PlacementMatch[],
): PlacementGroup[] {
  return rankElimination(
    bracketMatches,
    () => true,
    (m) => m.round,
  );
}

/**
 * Double elimination (see generateDoubleEliminationBracket): upper rounds 1..M
 * and merge-playoff rounds M+1..k+1 are 'winners', losers-bracket rounds are
 * 1..2(M-1). An upper loss in rounds ≤ M only drops the player to the losers
 * bracket; a losers-bracket loss or a merge-playoff loss eliminates. Everyone out
 * of the losers bracket ranks below everyone who reached the merge playoff.
 *
 * M is derived from the rows (the generator clamps the stored `mergeRound` to the
 * real bracket size), so a stored value larger than the bracket cannot skew it.
 */
function rankDoubleElimination(
  bracketMatches: PlacementMatch[],
): PlacementGroup[] {
  const maxLosersRound = bracketMatches
    .filter((m) => m.bracketType === 'losers')
    .reduce((max, m) => Math.max(max, m.round), 0);
  const mergeRound = maxLosersRound / 2 + 1;
  const MERGE_TIER = 1000;

  return rankElimination(
    bracketMatches,
    (m) => m.bracketType === 'losers' || m.round > mergeRound,
    (m) => (m.bracketType === 'losers' ? m.round : MERGE_TIER + m.round),
  );
}

/**
 * groups_playoff: the playoff is a single-elimination bracket; group-stage
 * leftovers rank below it by their place in the group — all third places share
 * the next range, then all fourth places, and so on.
 */
function rankGroupsPlayoff(
  allMatches: PlacementMatch[],
  standings: GroupStanding[],
): PlacementGroup[] {
  const playoff = rankSingleElimination(
    allMatches.filter((m) => m.phase === 'playoff'),
  );
  const inPlayoff = new Set(playoff.flatMap((g) => g.userIds));

  const byRank = new Map<number, UUID[]>();
  for (const group of standings) {
    for (const row of group.rows) {
      if (inPlayoff.has(row.userId)) continue;
      const list = byRank.get(row.rank) ?? [];
      list.push(row.userId);
      byRank.set(row.rank, list);
    }
  }

  const groups = [...playoff];
  let next = inPlayoff.size + 1;
  for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
    const userIds = byRank.get(rank) ?? [];
    groups.push({
      placeFrom: next,
      placeTo: next + userIds.length - 1,
      userIds,
    });
    next += userIds.length;
  }
  return groups;
}

/** Round robin: the standings rank is final and never shared. */
function rankRoundRobin(standings: GroupStanding[]): PlacementGroup[] {
  const rows = standings[0]?.rows ?? [];
  return rows.map((r) => ({
    placeFrom: r.rank,
    placeTo: r.rank,
    userIds: [r.userId],
  }));
}

/**
 * Final places of a finished tournament, best first. Shared places come back as
 * one group (e.g. `{ placeFrom: 3, placeTo: 4, userIds: [a, b] }`).
 *
 * @throws {Error} If the bracket has no single champion (not played out).
 */
export function computeFinalPlacements(
  format: ITournamentFormat,
  allMatches: PlacementMatch[],
  standings: GroupStanding[],
): PlacementGroup[] {
  switch (format) {
    case 'single_elimination':
      return rankSingleElimination(allMatches);
    case 'double_elimination':
      return rankDoubleElimination(allMatches);
    case 'groups_playoff':
      return rankGroupsPlayoff(allMatches, standings);
    case 'round_robin':
      return rankRoundRobin(standings);
  }
}

/**
 * DB-facing wrapper: final places of a tournament from its stored matches.
 * Only meaningful once the tournament is `completed`.
 */
export async function getFinalPlacements(tournament: {
  id: UUID;
  format: ITournamentFormat;
}): Promise<PlacementGroup[]> {
  const [allMatches, standings] = await Promise.all([
    getTournamentMatches(tournament.id),
    getStandings(tournament.id, tournament.format),
  ]);
  return computeFinalPlacements(tournament.format, allMatches, standings);
}
