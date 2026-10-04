import type { UUID } from 'crypto';

import type { Api } from 'grammy';

import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import {
  matches,
  matchFrames,
  notifications,
  tables,
  tournamentParticipants,
  tournamentReferees,
  tournaments,
  tournamentTables,
} from '@/db/schema.js';
import type { ITournamentFormat } from '@/db/schema/tournaments.js';
import {
  callMatchToTable,
  confirmResult,
  disputeResult,
  getMatch,
  recordRefereeResult,
  reportResult,
  setMatchTable,
  setTechnicalResult,
} from '@/services/matchService.js';
import {
  canManageTournamentAsUser,
  getMatchDecisionRecipients,
  getRefereeAttention,
  getRefereeTournaments,
} from '@/services/refereeService.js';
import { notifyResultDisputed } from '@/services/notificationService.js';
import { startTournamentFull } from '@/services/tournamentStartService.js';

import {
  createAdminUser,
  createTournament,
  createUser,
  createVenue,
  seatedMatches,
} from '../helpers/factories.js';
import { createMockBotApi } from '../helpers/mockBotApi.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

/**
 * A running single_day race-to-3 tournament of `playerCount` fresh players
 * (seeded in creation order) with `tableCount` linked tables and a referee.
 */
async function startWith(
  format: ITournamentFormat,
  tableCount: number,
  playerCount: number,
) {
  const venue = await createVenue();
  const referee = await createUser();
  const tournament = await createTournament({
    venueId: venue.id,
    status: 'registration_closed',
    format,
    winScore: 3,
  });

  const tableIds: UUID[] = [];
  for (let i = 0; i < tableCount; i++) {
    const table = must(
      (
        await db
          .insert(tables)
          .values({ name: `Стол ${String(i + 1)}`, venueId: venue.id })
          .returning()
      )[0],
      'table',
    );
    tableIds.push(table.id);
    await db.insert(tournamentTables).values({
      tournamentId: tournament.id,
      tableId: table.id,
      position: i,
    });
  }

  const playerIds: UUID[] = [];
  for (let i = 0; i < playerCount; i++) {
    const user = await createUser();
    playerIds.push(user.id);
    await db.insert(tournamentParticipants).values({
      tournamentId: tournament.id,
      userId: user.id,
      status: 'confirmed',
      seed: i + 1,
    });
  }

  await db
    .insert(tournamentReferees)
    .values({ tournamentId: tournament.id, userId: referee.id });

  const botApi = createMockBotApi() as unknown as Api;
  await startTournamentFull(tournament.id, botApi);
  return { tournament, botApi, referee, venue, tableIds, playerIds };
}

/** An extra table at the venue, linked to the tournament when `link` is set. */
async function addTable(
  venueId: UUID,
  tournamentId: UUID,
  link: boolean,
): Promise<UUID> {
  const table = must(
    (
      await db.insert(tables).values({ name: 'Доп. стол', venueId }).returning()
    )[0],
    'table',
  );
  if (link) {
    await db
      .insert(tournamentTables)
      .values({ tournamentId, tableId: table.id, position: 99 });
  }
  return table.id;
}

async function firstCalled(tournamentId: UUID) {
  return must((await seatedMatches(tournamentId))[0], 'called match');
}

async function waitingMatches(tournamentId: UUID) {
  return db.query.matches.findMany({
    where: and(
      eq(matches.tournamentId, tournamentId),
      eq(matches.status, 'scheduled'),
    ),
    orderBy: [asc(matches.round), asc(matches.position)],
  });
}

async function reload(matchId: UUID) {
  return must(await getMatch(matchId), 'match');
}

async function titlesOf(userId: UUID): Promise<string[]> {
  const rows = await db.query.notifications.findMany({
    where: eq(notifications.userId, userId),
  });
  return rows.map((n) => n.title);
}

/** The winner's slot in the next match, by the bracket routing of `matchId`. */
async function nextSlotHolder(matchId: UUID): Promise<UUID | null> {
  const m = await reload(matchId);
  const next = await reload(must(m.nextMatchId, 'next match id'));
  return m.nextMatchPosition === 'player1' ? next.player1Id : next.player2Id;
}

/** p1 reports a 3:1 win, opponent disputes it. */
async function reportAndDispute(matchId: UUID) {
  const m = await reload(matchId);
  const p1 = must(m.player1Id, 'p1');
  const p2 = must(m.player2Id, 'p2');
  expect((await reportResult(matchId, p1, 3, 1)).success).toBe(true);
  const disputed = await disputeResult(matchId, p2);
  expect(disputed.success).toBe(true);
  return { p1, p2, disputed };
}

describe('recordRefereeResult', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('completes a called match at once, advances the winner, notifies both', async () => {
    const { tournament, botApi, referee } = await startWith(
      'single_elimination',
      1,
      4,
    );
    const called = await firstCalled(tournament.id);
    const p1 = must(called.player1Id, 'p1');
    const p2 = must(called.player2Id, 'p2');

    const res = await recordRefereeResult(
      called.id,
      referee.id,
      { kind: 'score', player1Score: 1, player2Score: 3 },
      botApi,
    );
    expect(res).toEqual({ success: true, wasDisputed: false });

    const after = await reload(called.id);
    expect(after.status).toBe('completed');
    expect(after.winnerId).toBe(p2);
    expect([after.player1Score, after.player2Score]).toEqual([1, 3]);
    expect(after.reportedBy).toBe(referee.id);
    expect(after.confirmedBy).toBe(referee.id);
    expect(after.startedAt).not.toBeNull();
    expect(after.calledAt).toBeNull();
    expect(after.callDeadlineAt).toBeNull();
    expect(await nextSlotHolder(called.id)).toBe(p2);

    for (const player of [p1, p2]) {
      expect(await titlesOf(player)).toContain('Результат зафиксирован судьёй');
    }
  });

  it('overrides a pending player report', async () => {
    const { tournament, botApi, referee } = await startWith(
      'single_elimination',
      1,
      4,
    );
    const called = await firstCalled(tournament.id);
    const p1 = must(called.player1Id, 'p1');
    expect((await reportResult(called.id, p1, 3, 0)).success).toBe(true);

    const res = await recordRefereeResult(
      called.id,
      referee.id,
      { kind: 'score', player1Score: 2, player2Score: 3 },
      botApi,
    );
    expect(res.success).toBe(true);
    const after = await reload(called.id);
    expect(after.status).toBe('completed');
    expect(after.winnerId).toBe(called.player2Id);
  });

  it('closes a disputed match and clears the dispute marker', async () => {
    const { tournament, botApi, referee } = await startWith(
      'single_elimination',
      1,
      4,
    );
    const called = await firstCalled(tournament.id);
    const { p2, disputed } = await reportAndDispute(called.id);

    expect(disputed.previous?.summary).toBe('3:1');
    const marked = await reload(called.id);
    expect(marked.status).toBe('in_progress');
    expect(marked.disputedAt).not.toBeNull();
    expect(marked.disputedBy).toBe(p2);
    expect(marked.disputedScore).toBe('3:1');

    const res = await recordRefereeResult(
      called.id,
      referee.id,
      { kind: 'score', player1Score: 3, player2Score: 2 },
      botApi,
    );
    expect(res).toEqual({ success: true, wasDisputed: true });
    const after = await reload(called.id);
    expect(after.disputedAt).toBeNull();
    expect(after.disputedBy).toBeNull();
    expect(after.disputedScore).toBeNull();
  });

  it('stores a frame breakdown and replaces draft frames', async () => {
    const { tournament, botApi, referee } = await startWith(
      'single_elimination',
      1,
      4,
    );
    const called = await firstCalled(tournament.id);
    await db.insert(matchFrames).values({
      matchId: called.id,
      frameNumber: 1,
      player1Points: 1,
      player2Points: 99,
    });

    const res = await recordRefereeResult(
      called.id,
      referee.id,
      {
        kind: 'frames',
        frames: [
          { player1Points: 74, player2Points: 15, player1Break: 50 },
          { player1Points: 10, player2Points: 60 },
          { player1Points: 64, player2Points: 30 },
          { player1Points: 70, player2Points: 2 },
        ],
      },
      botApi,
    );
    expect(res.success).toBe(true);

    const after = await reload(called.id);
    expect([after.player1Score, after.player2Score]).toEqual([3, 1]);
    expect(after.winnerId).toBe(called.player1Id);
    const frames = await db.query.matchFrames.findMany({
      where: eq(matchFrames.matchId, called.id),
      orderBy: asc(matchFrames.frameNumber),
    });
    expect(frames.map((f) => [f.player1Points, f.player2Points])).toEqual([
      [74, 15],
      [10, 60],
      [64, 30],
      [70, 2],
    ]);
    expect(frames[0]?.player1Break).toBe(50);
  });

  it('an aggregate score drops draft frames', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    await db.insert(matchFrames).values({
      matchId: called.id,
      frameNumber: 1,
      player1Points: 1,
      player2Points: 99,
    });

    expect(
      (
        await recordRefereeResult(called.id, referee.id, {
          kind: 'score',
          player1Score: 3,
          player2Score: 0,
        })
      ).success,
    ).toBe(true);
    const frames = await db.query.matchFrames.findMany({
      where: eq(matchFrames.matchId, called.id),
    });
    expect(frames).toHaveLength(0);
  });

  it.each([
    [3, 3, /Оба игрока/],
    [2, 1, /должен набрать 3/],
    [3, 5, /от 0 до 3/],
    [-1, 3, /от 0 до 3/],
  ])('rejects the score %i:%i', async (s1, s2, error) => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const res = await recordRefereeResult(called.id, referee.id, {
      kind: 'score',
      player1Score: s1,
      player2Score: s2,
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(error);
    expect((await reload(called.id)).status).toBe('scheduled');
  });

  it('rejects frames after the match was decided', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const win = { player1Points: 60, player2Points: 10 };
    const res = await recordRefereeResult(called.id, referee.id, {
      kind: 'frames',
      frames: [win, win, win, win],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/матч уже решён/);
  });

  it('rejects a completed match', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const score = { kind: 'score', player1Score: 3, player2Score: 0 } as const;
    expect(
      (await recordRefereeResult(called.id, referee.id, score)).success,
    ).toBe(true);
    const again = await recordRefereeResult(called.id, referee.id, score);
    expect(again.success).toBe(false);
    if (!again.success) expect(again.error).toMatch(/завершён/);
  });

  it('rejects a match of a tournament that is not running', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    await db
      .update(tournaments)
      .set({ status: 'registration_closed' })
      .where(eq(tournaments.id, tournament.id));
    const res = await recordRefereeResult(called.id, referee.id, {
      kind: 'score',
      player1Score: 3,
      player2Score: 0,
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe('Турнир не идёт');
  });

  it('rejects a match with an empty slot', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    const final = must(
      await db.query.matches.findFirst({
        where: and(
          eq(matches.tournamentId, tournament.id),
          eq(matches.round, 2),
        ),
      }),
      'final',
    );
    const res = await recordRefereeResult(final.id, referee.id, {
      kind: 'score',
      player1Score: 3,
      player2Score: 0,
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/обоих игроков/);
  });

  it('racing a confirmation: exactly one completes the match', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const p1 = must(called.player1Id, 'p1');
    const p2 = must(called.player2Id, 'p2');
    expect((await reportResult(called.id, p1, 3, 0)).success).toBe(true);

    const [byReferee, byPlayer] = await Promise.all([
      recordRefereeResult(called.id, referee.id, {
        kind: 'score',
        player1Score: 0,
        player2Score: 3,
      }),
      confirmResult(called.id, p2),
    ]);
    expect([byReferee.success, byPlayer.success].filter(Boolean)).toHaveLength(
      1,
    );

    const after = await reload(called.id);
    expect(after.status).toBe('completed');
    expect(await nextSlotHolder(called.id)).toBe(after.winnerId);
  });

  it('racing a technical result: exactly one completes the match', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const p1 = must(called.player1Id, 'p1');

    const [byResult, byTechnical] = await Promise.all([
      recordRefereeResult(called.id, referee.id, {
        kind: 'score',
        player1Score: 0,
        player2Score: 3,
      }),
      setTechnicalResult(called.id, p1, 'Решение судьи', referee.id),
    ]);
    expect(
      [byResult.success, byTechnical.success].filter(Boolean),
    ).toHaveLength(1);

    const after = await reload(called.id);
    expect(after.isTechnicalResult).toBe(byTechnical.success);
    expect(await nextSlotHolder(called.id)).toBe(after.winnerId);
  });
});

describe('dispute marker', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('survives a re-report and is cleared by the confirmation', async () => {
    const { tournament } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const { p1, p2 } = await reportAndDispute(called.id);

    expect((await reportResult(called.id, p2, 2, 3)).success).toBe(true);
    expect((await reload(called.id)).disputedAt).not.toBeNull();

    expect((await confirmResult(called.id, p1)).success).toBe(true);
    const after = await reload(called.id);
    expect(after.status).toBe('completed');
    expect(after.disputedAt).toBeNull();
  });

  it('is cleared by a technical result', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const { p1 } = await reportAndDispute(called.id);

    expect(
      (await setTechnicalResult(called.id, p1, 'Решение судьи', referee.id))
        .success,
    ).toBe(true);
    expect((await reload(called.id)).disputedAt).toBeNull();
  });
});

describe('guarded player reports', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('a report cannot overwrite a pending one', async () => {
    const { tournament } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const p1 = must(called.player1Id, 'p1');
    const p2 = must(called.player2Id, 'p2');
    expect((await reportResult(called.id, p1, 3, 0)).success).toBe(true);

    const second = await reportResult(called.id, p2, 0, 3);
    expect(second.success).toBe(false);
    expect((await reload(called.id)).winnerId).toBe(p1);
  });
});

describe('callMatchToTable', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('calls a waiting match to a free table of the tournament', async () => {
    const { tournament, botApi, venue } = await startWith(
      'single_elimination',
      1,
      4,
    );
    const waiting = must(
      (await waitingMatches(tournament.id)).find(
        (m) => m.calledAt === null && m.player1Id && m.player2Id,
      ),
      'waiting match',
    );
    const extra = await addTable(venue.id, tournament.id, true);

    const res = await callMatchToTable(waiting.id, extra, botApi);
    expect(res).toEqual({ success: true });
    const after = await reload(waiting.id);
    expect(after.tableId).toBe(extra);
    expect(after.calledAt).not.toBeNull();
    expect(after.callDeadlineAt).not.toBeNull();
    expect(await titlesOf(must(after.player1Id, 'p1'))).toContain(
      'Вас вызывают к столу',
    );
  });

  it('rejects a table that does not belong to the tournament', async () => {
    const { tournament, venue } = await startWith('single_elimination', 1, 4);
    const waiting = must(
      (await waitingMatches(tournament.id)).find((m) => m.calledAt === null),
      'waiting match',
    );
    const foreign = await addTable(venue.id, tournament.id, false);
    const res = await callMatchToTable(waiting.id, foreign);
    expect(res).toEqual({
      success: false,
      error: 'Стол не принадлежит турниру',
    });
  });

  it('rejects an occupied table', async () => {
    const { tournament, tableIds } = await startWith(
      'single_elimination',
      1,
      4,
    );
    const waiting = must(
      (await waitingMatches(tournament.id)).find(
        (m) => m.calledAt === null && m.player1Id && m.player2Id,
      ),
      'waiting match',
    );
    const res = await callMatchToTable(waiting.id, must(tableIds[0], 'table'));
    expect(res.success).toBe(false);
    expect((await reload(waiting.id)).calledAt).toBeNull();
  });

  it('rejects a match whose player is at another table', async () => {
    // Round robin of 3 on one table: the waiting matches share a player with
    // the called one.
    const { tournament, venue } = await startWith('round_robin', 1, 3);
    const called = await firstCalled(tournament.id);
    const busy = new Set([called.player1Id, called.player2Id]);
    const blocked = must(
      (await waitingMatches(tournament.id)).find(
        (m) =>
          m.calledAt === null &&
          (busy.has(m.player1Id) || busy.has(m.player2Id)),
      ),
      'blocked match',
    );
    const extra = await addTable(venue.id, tournament.id, true);

    const res = await callMatchToTable(blocked.id, extra);
    expect(res.success).toBe(false);
  });

  it('calls a match to the table reserved for it by hand', async () => {
    const { tournament, venue } = await startWith('single_elimination', 1, 4);
    const waiting = must(
      (await waitingMatches(tournament.id)).find(
        (m) => m.calledAt === null && m.player1Id && m.player2Id,
      ),
      'waiting match',
    );
    const extra = await addTable(venue.id, tournament.id, true);
    expect((await setMatchTable(waiting.id, extra)).success).toBe(true);

    expect(await callMatchToTable(waiting.id, extra)).toEqual({
      success: true,
    });
  });

  it('a manual call clears the absent mark of its players', async () => {
    const { tournament, venue } = await startWith('single_elimination', 1, 4);
    const waiting = must(
      (await waitingMatches(tournament.id)).find(
        (m) => m.calledAt === null && m.player1Id && m.player2Id,
      ),
      'waiting match',
    );
    const players = [
      must(waiting.player1Id, 'p1'),
      must(waiting.player2Id, 'p2'),
    ];
    await db
      .update(tournamentParticipants)
      .set({ absentSince: new Date() })
      .where(eq(tournamentParticipants.tournamentId, tournament.id));
    const extra = await addTable(venue.id, tournament.id, true);

    expect(await callMatchToTable(waiting.id, extra)).toEqual({
      success: true,
    });
    const rows = await db.query.tournamentParticipants.findMany({
      where: eq(tournamentParticipants.tournamentId, tournament.id),
    });
    for (const row of rows) {
      // Only the called players are back; the others stay absent.
      expect(row.absentSince === null).toBe(players.includes(row.userId));
    }
  });

  it('taking the table of a called match tells its players the call is off', async () => {
    const { tournament, botApi } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const tableId = must(called.tableId, 'table');
    const waiting = must(
      (await waitingMatches(tournament.id)).find(
        (m) => m.calledAt === null && m.player1Id && m.player2Id,
      ),
      'waiting match',
    );

    expect(await setMatchTable(waiting.id, tableId, botApi)).toEqual({
      success: true,
    });
    const after = await reload(called.id);
    expect(after.tableId).toBeNull();
    expect(after.calledAt).toBeNull();
    for (const p of [called.player1Id, called.player2Id]) {
      expect(await titlesOf(must(p, 'player'))).toContain('Вызов отменён');
    }
    // The match that took the table was not called, so its players hear nothing.
    expect(await titlesOf(must(waiting.player1Id, 'p1'))).not.toContain(
      'Вызов отменён',
    );
  });

  it('clearing the table of a called match tells its players the call is off', async () => {
    const { tournament, botApi } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);

    expect(await setMatchTable(called.id, null, botApi)).toEqual({
      success: true,
    });
    expect(await titlesOf(must(called.player1Id, 'p1'))).toContain(
      'Вызов отменён',
    );
  });

  it('rejects an already called match', async () => {
    const { tournament, venue } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const extra = await addTable(venue.id, tournament.id, true);
    const res = await callMatchToTable(called.id, extra);
    expect(res.success).toBe(false);
  });
});

describe('refereeService', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('lists only the tournaments the user referees, with counts', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    await startWith('single_elimination', 1, 4); // someone else's

    const list = await getRefereeTournaments({
      id: referee.id,
      role: 'user',
    });
    expect(list.map((t) => t.id)).toEqual([tournament.id]);
    expect(list[0]?.counts).toMatchObject({
      called: 1,
      queued: 1,
      inProgress: 0,
      disputed: 0,
    });

    const stranger = await createUser();
    expect(
      await getRefereeTournaments({ id: stranger.id, role: 'user' }),
    ).toEqual([]);
  });

  it('admins see every running tournament', async () => {
    const a = await startWith('single_elimination', 1, 4);
    const b = await startWith('single_elimination', 1, 4);
    await createTournament({ status: 'registration_open' });
    const admin = await createAdminUser();

    const ids = (await getRefereeTournaments(admin)).map((t) => t.id);
    expect(ids.sort()).toEqual([a.tournament.id, b.tournament.id].sort());
  });

  it('a referee sees a not yet started tournament, without attention items', async () => {
    const referee = await createUser();
    const upcoming = await createTournament({ status: 'registration_open' });
    await db
      .insert(tournamentReferees)
      .values({ tournamentId: upcoming.id, userId: referee.id });

    const actor = { id: referee.id, role: 'user' } as const;
    expect((await getRefereeTournaments(actor)).map((t) => t.id)).toEqual([
      upcoming.id,
    ]);
    expect(await getRefereeAttention(actor)).toEqual([]);
  });

  it('attention: disputes first, then overdue calls', async () => {
    const { tournament, referee, venue } = await startWith(
      'single_elimination',
      1,
      4,
    );
    const called = await firstCalled(tournament.id);
    await reportAndDispute(called.id);

    // The second match gets called to an extra table, then its deadline passes.
    const waiting = must(
      (await waitingMatches(tournament.id)).find(
        (m) => m.calledAt === null && m.player1Id && m.player2Id,
      ),
      'waiting match',
    );
    const extra = await addTable(venue.id, tournament.id, true);
    expect((await callMatchToTable(waiting.id, extra)).success).toBe(true);
    const deadline = must(
      (await reload(waiting.id)).callDeadlineAt,
      'deadline',
    );

    const actor = { id: referee.id, role: 'user' } as const;
    expect(await getRefereeAttention(actor)).toEqual([
      { matchId: called.id, tournamentId: tournament.id, reason: 'disputed' },
    ]);
    const later = new Date(deadline.getTime() + 1000);
    expect(await getRefereeAttention(actor, later)).toEqual([
      { matchId: called.id, tournamentId: tournament.id, reason: 'disputed' },
      {
        matchId: waiting.id,
        tournamentId: tournament.id,
        reason: 'overdue_call',
      },
    ]);
    const [summary] = await getRefereeTournaments(actor, later);
    expect(summary?.counts).toMatchObject({ disputed: 1, overdueCalls: 1 });
  });

  it('canManageTournamentAsUser: admin or referee of that tournament', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    const other = await startWith('single_elimination', 1, 4);
    const admin = await createAdminUser();
    const actor = { id: referee.id, role: 'user' } as const;

    expect(await canManageTournamentAsUser(actor, tournament.id)).toBe(true);
    expect(await canManageTournamentAsUser(actor, other.tournament.id)).toBe(
      false,
    );
    expect(await canManageTournamentAsUser(admin, other.tournament.id)).toBe(
      true,
    );
  });

  it('decision recipients: referees, else the creator', async () => {
    const { tournament, referee } = await startWith('single_elimination', 1, 4);
    expect(await getMatchDecisionRecipients(tournament.id)).toEqual([
      referee.id,
    ]);

    const bare = await createTournament();
    expect(await getMatchDecisionRecipients(bare.id)).toEqual([bare.createdBy]);
  });
});

describe('dispute notifications', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  /** Dispute the called match and send the notification like the routes do. */
  async function disputeAndNotify(tournamentId: UUID, botApi: Api) {
    const called = await firstCalled(tournamentId);
    const { p1, p2, disputed } = await reportAndDispute(called.id);
    await notifyResultDisputed(
      botApi,
      await reload(called.id),
      p2,
      disputed.previous,
    );
    return { matchId: called.id, p1, p2 };
  }

  async function disputeRows(userId: UUID) {
    const rows = await db.query.notifications.findMany({
      where: eq(notifications.userId, userId),
    });
    return rows.filter((n) => n.type === 'result_dispute');
  }

  it('reaches the referee with the disputed score', async () => {
    const { tournament, botApi, referee } = await startWith(
      'single_elimination',
      1,
      4,
    );
    const { matchId, p1, p2 } = await disputeAndNotify(tournament.id, botApi);

    const [row] = await disputeRows(referee.id);
    expect(row?.title).toBe('Спор по результату');
    expect(row?.matchId).toBe(matchId);
    expect(row?.message).toContain('3:1');
    // Players still get their own notice.
    for (const player of [p1, p2]) {
      expect((await disputeRows(player)).map((n) => n.title)).toEqual([
        'Результат оспорен',
      ]);
    }
  });

  it('falls back to the creator when there is no referee', async () => {
    const { tournament, botApi, referee } = await startWith(
      'single_elimination',
      1,
      4,
    );
    await db
      .delete(tournamentReferees)
      .where(eq(tournamentReferees.userId, referee.id));

    const { p1 } = await disputeAndNotify(tournament.id, botApi);
    expect(await disputeRows(tournament.createdBy)).toHaveLength(1);
    expect(await disputeRows(referee.id)).toHaveLength(0);
    const [notice] = await disputeRows(p1);
    expect(notice?.message).toContain('Обратитесь к организатору турнира');
  });

  it('players are sent to the referee when there is one', async () => {
    const { tournament, botApi } = await startWith('single_elimination', 1, 4);
    const { p1 } = await disputeAndNotify(tournament.id, botApi);
    const [notice] = await disputeRows(p1);
    expect(notice?.message).toContain('Обратитесь к судье турнира');
  });

  it('an admin dispute is attributed to the administrator', async () => {
    const { tournament, botApi, referee } = await startWith(
      'single_elimination',
      1,
      4,
    );
    const admin = await createAdminUser();
    const called = await firstCalled(tournament.id);
    const p1 = must(called.player1Id, 'p1');
    const p2 = must(called.player2Id, 'p2');
    expect((await reportResult(called.id, p1, 3, 1)).success).toBe(true);
    const disputed = await disputeResult(called.id, admin.id, {
      byAdmin: true,
    });
    expect(disputed.success).toBe(true);
    const after = await reload(called.id);
    expect(after.disputedBy).toBe(admin.id);

    await notifyResultDisputed(botApi, after, admin.id, disputed.previous);
    for (const userId of [p1, p2, referee.id]) {
      const [row] = await disputeRows(userId);
      expect(row?.message).toContain('Администратор оспорил результат');
    }
  });

  it('a referee playing in the match gets the referee notice', async () => {
    const { tournament, botApi } = await startWith('single_elimination', 1, 4);
    const called = await firstCalled(tournament.id);
    const p1 = must(called.player1Id, 'p1');
    await db
      .insert(tournamentReferees)
      .values({ tournamentId: tournament.id, userId: p1 });

    await disputeAndNotify(tournament.id, botApi);
    expect((await disputeRows(p1)).map((n) => n.title)).toEqual([
      'Спор по результату',
    ]);
  });
});
