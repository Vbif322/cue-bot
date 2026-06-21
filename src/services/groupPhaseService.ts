import type { UUID } from 'crypto';

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

  const participants = await getConfirmedParticipantsBySeed(tournamentId);
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
    matchesByGroup[g] = gMatches.map((m) => ({
      player1Id: m.player1Id,
      player2Id: m.player2Id,
      winnerId: m.winnerId,
      player1Score: m.player1Score,
      player2Score: m.player2Score,
      status: m.status,
    }));
  }

  return computeAllStandings(membersByGroup, matchesByGroup);
}
