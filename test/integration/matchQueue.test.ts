import type { UUID } from 'crypto';

import type { Api } from 'grammy';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import {
  matches,
  tables,
  tournamentParticipants,
  tournamentTables,
} from '@/db/schema.js';
import type { ITournamentFormat } from '@/db/schema/tournaments.js';
import {
  getNextReadyMatch,
  getQueuePlayersBusyElsewhere,
  setMatchQueue,
} from '@/services/matchService.js';
import { startTournamentFull } from '@/services/tournamentStartService.js';

import {
  completeMatch,
  createTournament,
  createUser,
  createVenue,
} from '../helpers/factories.js';
import { createMockBotApi } from '../helpers/mockBotApi.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

type MatchRow = typeof matches.$inferSelect;

/**
 * A running tournament of `userIds` (seeded in that order) with `tableCount`
 * linked tables.
 */
async function startWith(
  format: ITournamentFormat,
  tableCount: number,
  userIds: UUID[],
) {
  const venue = await createVenue();
  const tournament = await createTournament({
    venueId: venue.id,
    status: 'registration_closed',
    format,
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

  for (const [i, userId] of userIds.entries()) {
    await db.insert(tournamentParticipants).values({
      tournamentId: tournament.id,
      userId,
      status: 'confirmed',
      seed: i + 1,
    });
  }

  const botApi = createMockBotApi() as unknown as Api;
  await startTournamentFull(tournament.id, botApi);
  return { tournamentId: tournament.id, botApi };
}

async function createUsers(count: number): Promise<UUID[]> {
  const ids: UUID[] = [];
  for (let i = 0; i < count; i++) ids.push((await createUser()).id);
  return ids;
}

/** A running 8-player round robin with `tableCount` linked tables. */
async function startRoundRobin(tableCount: number) {
  return startWith('round_robin', tableCount, await createUsers(8));
}

/** Waiting matches (scheduled, no table) in default bracket order. */
async function waitingMatches(tournamentId: UUID): Promise<MatchRow[]> {
  return db.query.matches.findMany({
    where: and(
      eq(matches.tournamentId, tournamentId),
      eq(matches.status, 'scheduled'),
      isNull(matches.tableId),
    ),
    orderBy: [asc(matches.round), asc(matches.position)],
  });
}

async function liveMatches(tournamentId: UUID): Promise<MatchRow[]> {
  return db.query.matches.findMany({
    where: and(
      eq(matches.tournamentId, tournamentId),
      eq(matches.status, 'in_progress'),
    ),
  });
}

const hasPlayer = (m: MatchRow, ids: Set<UUID | null>): boolean =>
  ids.has(m.player1Id) || ids.has(m.player2Id);

describe('match queue (table auto-assignment order)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('seats the match the admin moved to the front', async () => {
    const { tournamentId, botApi } = await startRoundRobin(1);
    const [live] = await liveMatches(tournamentId);
    const current = must(live, 'live match');

    const waiting = await waitingMatches(tournamentId);
    const last = must(waiting.at(-1), 'last waiting match');
    const ids = [last.id, ...waiting.slice(0, -1).map((m) => m.id)];
    expect(await setMatchQueue(tournamentId, ids)).toEqual({ success: true });

    await completeMatch(current.id, must(current.player1Id, 'p1'), botApi);

    const seated = must(
      await db.query.matches.findFirst({ where: eq(matches.id, last.id) }),
      'moved match',
    );
    expect(seated.status).toBe('in_progress');
    expect(seated.tableId).toBe(current.tableId);
  });

  it('skips a queued match whose player is still at a table', async () => {
    const { tournamentId } = await startRoundRobin(2);
    const [a] = await liveMatches(tournamentId);
    const busy = new Set([
      must(a, 'live match').player1Id,
      must(a, 'live match').player2Id,
    ]);

    const waiting = await waitingMatches(tournamentId);
    const blocked = must(
      waiting.find((m) => hasPlayer(m, busy)),
      'match with a busy player',
    );
    const free = must(
      waiting.findLast((m) => !hasPlayer(m, busy)),
      'match with free players',
    );
    const rest = waiting
      .filter((m) => m.id !== blocked.id && m.id !== free.id)
      .map((m) => m.id);
    await setMatchQueue(tournamentId, [blocked.id, free.id, ...rest]);

    // Both tables are busy, so nothing is seated; the next pick skips `blocked`.
    const next = await getNextReadyMatch(tournamentId);
    expect(next?.id).toBe(free.id);
  });

  it('rejects a list that does not match the waiting set', async () => {
    const { tournamentId } = await startRoundRobin(1);
    const [live] = await liveMatches(tournamentId);
    const ids = (await waitingMatches(tournamentId)).map((m) => m.id);
    const [first] = ids;

    const stale = 'Очередь изменилась — обновите страницу';
    // Missing one.
    expect(await setMatchQueue(tournamentId, ids.slice(1))).toEqual({
      success: false,
      error: stale,
    });
    // Duplicate instead of a real id.
    expect(
      await setMatchQueue(tournamentId, [
        must(first, 'first'),
        must(first, 'first'),
        ...ids.slice(2),
      ]),
    ).toEqual({ success: false, error: stale });
    // A match that is already being played.
    expect(
      await setMatchQueue(tournamentId, [
        must(live, 'live').id,
        ...ids.slice(1),
      ]),
    ).toEqual({ success: false, error: stale });

    // Nothing was written.
    const rows = await waitingMatches(tournamentId);
    expect(rows.every((m) => m.queueOrder === null)).toBe(true);
  });

  it('seats another tournament once its players leave this one', async () => {
    const a = await startRoundRobin(1);
    const [live] = await liveMatches(a.tournamentId);
    const current = must(live, 'live match in A');
    const p1 = must(current.player1Id, 'p1');
    const p2 = must(current.player2Id, 'p2');

    // B pairs 1v4 and 2v3: each first-round match has a player busy in A.
    const b = await startWith('single_elimination', 2, [
      p1,
      p2,
      ...(await createUsers(2)),
    ]);
    expect(await liveMatches(b.tournamentId)).toHaveLength(0);
    const busy = await getQueuePlayersBusyElsewhere(b.tournamentId);
    expect(new Set(busy.map((x) => x.userId))).toEqual(new Set([p1, p2]));
    expect(busy.every((x) => x.tournamentId === a.tournamentId)).toBe(true);

    // Keep A's freed table away from p1/p2 so B's refill is what seats them.
    const aWaiting = await waitingMatches(a.tournamentId);
    const freed = new Set<UUID | null>([p1, p2]);
    await setMatchQueue(a.tournamentId, [
      ...aWaiting.filter((m) => !hasPlayer(m, freed)).map((m) => m.id),
      ...aWaiting.filter((m) => hasPlayer(m, freed)).map((m) => m.id),
    ]);

    await completeMatch(current.id, p1, a.botApi);

    expect(await liveMatches(b.tournamentId)).toHaveLength(2);
    expect(await getQueuePlayersBusyElsewhere(b.tournamentId)).toEqual([]);
  });

  it('rejects a tournament that is not running', async () => {
    const t = await createTournament({ status: 'registration_closed' });
    expect(await setMatchQueue(t.id, [])).toEqual({
      success: false,
      error: 'Очередь можно менять только в идущем турнире',
    });
  });

  it('rejects per-match scheduling', async () => {
    const t = await createTournament({
      status: 'in_progress',
      scheduleMode: 'per_match',
    });
    expect(await setMatchQueue(t.id, [])).toEqual({
      success: false,
      error: 'В режиме расписания по матчам столы назначаются вручную',
    });
  });
});
