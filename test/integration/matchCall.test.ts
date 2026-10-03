import type { UUID } from 'crypto';

import type { Api } from 'grammy';

import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import {
  matches,
  notifications,
  tables,
  tournamentParticipants,
  tournamentReferees,
  tournamentTables,
} from '@/db/schema.js';
import type { ITournamentFormat } from '@/db/schema/tournaments.js';
import {
  confirmResult,
  getMatch,
  reportResult,
} from '@/services/matchService.js';
import {
  extendCall,
  markParticipantPresent,
  markPlayerReady,
  noShowTechnicalLoss,
  postponeCalledMatch,
  processOverdueCalls,
} from '@/services/matchCallService.js';
import { MATCH_CALL_TIMEOUT_MS } from '@/services/matchCall.const.js';
import { startTournamentFull } from '@/services/tournamentStartService.js';

import {
  completeMatch,
  confirmPresence,
  createTournament,
  createUser,
  createVenue,
  seatedMatches,
} from '../helpers/factories.js';
import { createMockBotApi } from '../helpers/mockBotApi.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

/**
 * A running single_day tournament of `userIds` (seeded in that order) with
 * `tableCount` linked tables and, optionally, a referee.
 */
async function startWith(
  format: ITournamentFormat,
  tableCount: number,
  userIds: UUID[],
  refereeId?: UUID,
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

  if (refereeId) {
    await db
      .insert(tournamentReferees)
      .values({ tournamentId: tournament.id, userId: refereeId });
  }

  const botApi = createMockBotApi() as unknown as Api;
  await startTournamentFull(tournament.id, botApi);
  return { tournament, botApi };
}

async function createUsers(count: number): Promise<UUID[]> {
  const ids: UUID[] = [];
  for (let i = 0; i < count; i++) ids.push((await createUser()).id);
  return ids;
}

/** The single called match of a one-table tournament. */
async function calledMatch(tournamentId: UUID) {
  const [m] = await seatedMatches(tournamentId);
  const match = must(m, 'called match');
  expect(match.status).toBe('scheduled');
  expect(match.calledAt).not.toBeNull();
  return match;
}

async function notificationsOf(userId: UUID, type: string) {
  const rows = await db.query.notifications.findMany({
    where: eq(notifications.userId, userId),
  });
  return rows.filter((n) => n.type === type);
}

async function absentSince(tournamentId: UUID, userId: UUID) {
  const row = await db.query.tournamentParticipants.findFirst({
    where: and(
      eq(tournamentParticipants.tournamentId, tournamentId),
      eq(tournamentParticipants.userId, userId),
    ),
  });
  return must(row, 'participant').absentSince;
}

/** A moment safely past the match's presence deadline. */
const afterDeadline = (m: { callDeadlineAt: Date | null }) =>
  new Date(must(m.callDeadlineAt, 'deadline').getTime() + 1000);

describe('call to the table', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('a free table calls the players instead of starting the match', async () => {
    const { tournament } = await startWith(
      'single_elimination',
      1,
      await createUsers(4),
    );
    const match = await calledMatch(tournament.id);

    expect(match.tableId).not.toBeNull();
    expect(match.startedAt).toBeNull();
    const deadline = must(match.callDeadlineAt, 'deadline').getTime();
    expect(deadline - must(match.calledAt, 'calledAt').getTime()).toBe(
      MATCH_CALL_TIMEOUT_MS,
    );

    for (const playerId of [match.player1Id, match.player2Id]) {
      const calls = await notificationsOf(
        must(playerId, 'player'),
        'match_reminder',
      );
      expect(calls.map((n) => n.title)).toContain('Вас вызывают к столу');
    }
  });

  it('starts only once both players confirm presence', async () => {
    const { tournament, botApi } = await startWith(
      'single_elimination',
      1,
      await createUsers(4),
    );
    const match = await calledMatch(tournament.id);
    const p1 = must(match.player1Id, 'p1');
    const p2 = must(match.player2Id, 'p2');

    expect(await markPlayerReady(match.id, p1, botApi)).toEqual({
      success: true,
      started: false,
    });
    // A repeated press changes nothing.
    expect(await markPlayerReady(match.id, p1, botApi)).toEqual({
      success: true,
      started: false,
    });
    expect((await getMatch(match.id))?.status).toBe('scheduled');
    const nudges = await notificationsOf(p2, 'match_reminder');
    expect(nudges.map((n) => n.title)).toContain('Соперник уже у стола');

    expect(await markPlayerReady(match.id, p2, botApi)).toEqual({
      success: true,
      started: true,
    });
    const after = must(await getMatch(match.id), 'match');
    expect(after.status).toBe('in_progress');
    expect(after.startedAt).not.toBeNull();
    expect(after.tableId).toBe(match.tableId);
  });

  it('two simultaneous confirmations start the match exactly once', async () => {
    const { tournament } = await startWith(
      'single_elimination',
      1,
      await createUsers(4),
    );
    const match = await calledMatch(tournament.id);

    const results = await Promise.all([
      markPlayerReady(match.id, must(match.player1Id, 'p1')),
      markPlayerReady(match.id, must(match.player2Id, 'p2')),
    ]);

    const started = results.filter((r) => r.success && r.started);
    expect(started).toHaveLength(1);
    expect((await getMatch(match.id))?.status).toBe('in_progress');
  });

  it('rejects presence from someone who is not in the match', async () => {
    const { tournament } = await startWith(
      'single_elimination',
      1,
      await createUsers(4),
    );
    const match = await calledMatch(tournament.id);
    const stranger = await createUser();

    const result = await markPlayerReady(match.id, stranger.id);
    expect(result.success).toBe(false);
  });

  it('a called player is not called to a table in another tournament', async () => {
    const users = await createUsers(4);
    const a = await startWith('single_elimination', 1, users);
    const inA = await calledMatch(a.tournament.id);
    // B pairs 1v4 and 2v3, so each of its matches has a player called in A.
    const b = await startWith('single_elimination', 2, [
      must(inA.player1Id, 'p1'),
      must(inA.player2Id, 'p2'),
      ...(await createUsers(2)),
    ]);
    expect(await seatedMatches(b.tournament.id)).toHaveLength(0);
  });
});

describe('no-show', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('alerts the referee once when the deadline passes, and again after +5 min', async () => {
    const referee = await createUser();
    const { tournament, botApi } = await startWith(
      'single_elimination',
      1,
      await createUsers(4),
      referee.id,
    );
    const match = await calledMatch(tournament.id);
    await markPlayerReady(match.id, must(match.player1Id, 'p1'), botApi);

    // Before the deadline nothing happens.
    expect(await processOverdueCalls(botApi, new Date())).toBe(0);

    const late = afterDeadline(match);
    expect(await processOverdueCalls(botApi, late)).toBe(1);
    // A second sweep (or a restart) doesn't repeat the alert.
    expect(await processOverdueCalls(botApi, late)).toBe(0);

    const alerts = await notificationsOf(referee.id, 'match_no_show');
    expect(alerts).toHaveLength(1);
    // Only the player who didn't confirm is re-pinged.
    const p2Pings = await notificationsOf(
      must(match.player2Id, 'p2'),
      'match_reminder',
    );
    expect(p2Pings.map((n) => n.title)).toContain('Вас ждут за столом');
    const p1Pings = await notificationsOf(
      must(match.player1Id, 'p1'),
      'match_reminder',
    );
    expect(p1Pings.map((n) => n.title)).not.toContain('Вас ждут за столом');

    expect(await extendCall(match.id)).toEqual({ success: true });
    const extended = must(await getMatch(match.id), 'match');
    expect(extended.noShowAlertedAt).toBeNull();
    expect(await processOverdueCalls(botApi, late)).toBe(0);
    expect(await processOverdueCalls(botApi, afterDeadline(extended))).toBe(1);
    expect(await notificationsOf(referee.id, 'match_no_show')).toHaveLength(2);
  });

  it('alerts the tournament creator when there is no referee', async () => {
    const { tournament, botApi } = await startWith(
      'single_elimination',
      1,
      await createUsers(4),
    );
    const match = await calledMatch(tournament.id);

    expect(await processOverdueCalls(botApi, afterDeadline(match))).toBe(1);
    expect(
      await notificationsOf(tournament.createdBy, 'match_no_show'),
    ).toHaveLength(1);
  });

  it('postpone hands the table on and skips the absent player until they are back', async () => {
    // Round robin, 4 players, 1 table: 6 matches, each player in 3.
    const users = await createUsers(4);
    const { tournament, botApi } = await startWith('round_robin', 1, users);
    const match = await calledMatch(tournament.id);
    const present = must(match.player1Id, 'p1');
    const absent = must(match.player2Id, 'p2');
    const tableId = must(match.tableId, 'table');
    await markPlayerReady(match.id, present, botApi);

    const result = await postponeCalledMatch(match.id, botApi);
    expect(result).toEqual({ success: true, absentPlayerIds: [absent] });

    // The postponed match is back in the queue, un-called.
    const postponed = must(await getMatch(match.id), 'postponed');
    expect(postponed.status).toBe('scheduled');
    expect(postponed.tableId).toBeNull();
    expect(postponed.calledAt).toBeNull();
    expect(postponed.player1ReadyAt).toBeNull();
    expect(await absentSince(tournament.id, absent)).not.toBeNull();
    const marked = await notificationsOf(absent, 'match_reminder');
    expect(marked.map((n) => n.title)).toContain('Вы отмечены отсутствующим');

    // The table went straight to a match without the absent player.
    const next = await calledMatch(tournament.id);
    expect(next.tableId).toBe(tableId);
    expect([next.player1Id, next.player2Id]).not.toContain(absent);

    // Play everything that doesn't involve the absent player: the table is
    // never handed to one of their matches.
    for (let step = 0; step < 10; step++) {
      const [seated] = await seatedMatches(tournament.id);
      if (!seated) break;
      expect([seated.player1Id, seated.player2Id]).not.toContain(absent);
      await confirmPresence(seated.id, botApi);
      await completeMatch(seated.id, must(seated.player1Id, 'p1'), botApi);
    }
    expect(await seatedMatches(tournament.id)).toHaveLength(0);

    // Back at the club: their matches get the free table right away.
    expect(await markParticipantPresent(tournament.id, absent, botApi)).toEqual(
      {
        success: true,
        wasAbsent: true,
      },
    );
    expect(await absentSince(tournament.id, absent)).toBeNull();
    const resumed = await calledMatch(tournament.id);
    expect([resumed.player1Id, resumed.player2Id]).toContain(absent);
  });

  it('confirming presence clears an absent mark', async () => {
    const { tournament, botApi } = await startWith(
      'round_robin',
      1,
      await createUsers(4),
    );
    const match = await calledMatch(tournament.id);
    const p1 = must(match.player1Id, 'p1');
    await db
      .update(tournamentParticipants)
      .set({ absentSince: new Date() })
      .where(eq(tournamentParticipants.userId, p1));

    await markPlayerReady(match.id, p1, botApi);
    expect(await absentSince(tournament.id, p1)).toBeNull();
  });

  it('technical loss for a no-show advances the opponent and frees the table', async () => {
    const { tournament, botApi } = await startWith(
      'single_elimination',
      1,
      await createUsers(4),
    );
    const match = await calledMatch(tournament.id);
    const winner = must(match.player1Id, 'p1');
    const loser = must(match.player2Id, 'p2');

    expect(
      await noShowTechnicalLoss(match.id, 2, tournament.createdBy, botApi),
    ).toEqual({
      success: true,
    });

    const done = must(await getMatch(match.id), 'match');
    expect(done.status).toBe('completed');
    expect(done.winnerId).toBe(winner);
    expect(done.isTechnicalResult).toBe(true);
    expect(done.technicalReason).toBe('Неявка соперника');

    // Players hear about it; the table is handed to the other semi-final.
    const told = await notificationsOf(loser, 'result_confirmed');
    expect(told.map((n) => n.title)).toContain('Технический результат');
    const next = await calledMatch(tournament.id);
    expect(next.id).not.toBe(match.id);
    expect(next.tableId).toBe(match.tableId);

    // Eliminated in single elimination: no lingering absent mark.
    expect(await absentSince(tournament.id, loser)).toBeNull();
  });

  it('technical loss keeps the no-show absent while they still have matches', async () => {
    const { tournament, botApi } = await startWith(
      'round_robin',
      1,
      await createUsers(4),
    );
    const match = await calledMatch(tournament.id);
    const loser = must(match.player2Id, 'p2');

    await noShowTechnicalLoss(match.id, 2, tournament.createdBy, botApi);

    expect(await absentSince(tournament.id, loser)).not.toBeNull();
    const next = await calledMatch(tournament.id);
    expect([next.player1Id, next.player2Id]).not.toContain(loser);
  });

  it('referee actions reject a match that is not called', async () => {
    const { tournament, botApi } = await startWith(
      'single_elimination',
      1,
      await createUsers(4),
    );
    const match = await calledMatch(tournament.id);
    await confirmPresence(match.id, botApi);

    expect((await postponeCalledMatch(match.id, botApi)).success).toBe(false);
    expect((await extendCall(match.id)).success).toBe(false);
    expect(await processOverdueCalls(botApi, afterDeadline(match))).toBe(0);
  });
});

describe('result confirmation hands the table on', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('confirmResult with the bot api calls the next match to the freed table', async () => {
    const { tournament, botApi } = await startWith(
      'single_elimination',
      1,
      await createUsers(4),
    );
    const match = await calledMatch(tournament.id);
    await confirmPresence(match.id, botApi);
    const p1 = must(match.player1Id, 'p1');
    const p2 = must(match.player2Id, 'p2');

    await reportResult(match.id, p1, 3, 0);
    await confirmResult(match.id, p2, botApi);

    const next = await calledMatch(tournament.id);
    expect(next.id).not.toBe(match.id);
    expect(next.tableId).toBe(match.tableId);
    // The finished match doesn't hold the table any more.
    const rows = await db.query.matches.findMany({
      where: eq(matches.tableId, must(match.tableId, 'table')),
    });
    expect(rows.filter((m) => m.status !== 'completed')).toHaveLength(1);
  });
});
