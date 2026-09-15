import type { UUID } from 'crypto';

import type { Api } from 'grammy';

import { and, eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import {
  matches,
  tables,
  tournamentParticipants,
  tournamentTables,
} from '@/db/schema.js';
import { startTournamentFull } from '@/services/tournamentStartService.js';
import { confirmResult, reportResult } from '@/services/matchService.js';

import { createTournament, createUser, createVenue } from '../helpers/factories.js';
import { createMockBotApi } from '../helpers/mockBotApi.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

/**
 * Round robin with more tables than can actually be played at once: with N
 * players only floor(N/2) matches can run in parallel, but every other match is
 * already `scheduled`, so a naive auto-start hands the spare tables to matches
 * whose players are still at another table.
 */
async function setupRoundRobin(players: number, tableCount: number) {
  const venue = await createVenue();
  const tournament = await createTournament({
    venueId: venue.id,
    status: 'registration_closed',
    format: 'round_robin',
    winScore: 3,
  });

  for (let i = 0; i < tableCount; i++) {
    const [table] = await db
      .insert(tables)
      .values({ name: `Стол ${String(i + 1)}`, venueId: venue.id })
      .returning();
    await db.insert(tournamentTables).values({
      tournamentId: tournament.id,
      tableId: must(table, 'table').id,
      position: i,
    });
  }

  for (let i = 0; i < players; i++) {
    const user = await createUser();
    await db.insert(tournamentParticipants).values({
      tournamentId: tournament.id,
      userId: user.id,
      status: 'confirmed',
      seed: i + 1,
    });
  }

  return tournament;
}

async function liveMatches(tournamentId: UUID) {
  return db.query.matches.findMany({
    where: and(
      eq(matches.tournamentId, tournamentId),
      inArray(matches.status, ['in_progress']),
    ),
  });
}

describe('auto-start never double-books a player', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('leaves a spare table idle rather than starting a busy player', async () => {
    // 3 players => 3 matches, but only 1 can be played at a time.
    const tournament = await setupRoundRobin(3, 3);
    await startTournamentFull(tournament.id, (createMockBotApi() as unknown as Api));

    const live = await liveMatches(tournament.id);
    expect(live).toHaveLength(1);
  });

  it('starts disjoint matches in parallel when players allow it', async () => {
    // 4 players => 2 disjoint matches can run at once.
    const tournament = await setupRoundRobin(4, 3);
    await startTournamentFull(tournament.id, (createMockBotApi() as unknown as Api));

    const live = await liveMatches(tournament.id);
    expect(live).toHaveLength(2);

    const seen = new Set<UUID>();
    for (const match of live) {
      for (const id of [match.player1Id, match.player2Id]) {
        const playerId = must(id, 'player id');
        expect(seen.has(playerId)).toBe(false);
        seen.add(playerId);
      }
    }
  });

  it('hands the freed table to the next playable match once a blocker finishes', async () => {
    const tournament = await setupRoundRobin(3, 3);
    const botApi = (createMockBotApi() as unknown as Api);
    await startTournamentFull(tournament.id, botApi);

    const [first] = await liveMatches(tournament.id);
    const live = must(first, 'first live match');
    const reporter = must(live.player1Id, 'player1');
    const confirmer = must(live.player2Id, 'player2');

    await reportResult(live.id, reporter, 3, 0);
    await confirmResult(live.id, confirmer, botApi);

    // Completing the blocker must release a table to the next playable match.
    const after = await liveMatches(tournament.id);
    expect(after).toHaveLength(1);
    expect(after[0]?.id).not.toBe(live.id);
    expect(after[0]?.tableId).not.toBeNull();
  });
});
