import type { UUID } from 'crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { and, asc, eq, isNull } from 'drizzle-orm';

import { createAdminServer } from '@/admin/server/index.js';
import { bot } from '@/bot/instance.js';
import { db } from '@/db/db.js';
import {
  matches,
  tables,
  tournamentParticipants,
  tournamentReferees,
  tournaments,
  tournamentTables,
} from '@/db/schema.js';
import type { ITournamentScheduleMode } from '@/db/schema/tournaments.js';
import {
  disputeResult,
  getMatch,
  reportResult,
} from '@/services/matchService.js';
import { startTournamentFull } from '@/services/tournamentStartService.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import {
  createAdminUser,
  createTournament,
  createUser,
  createVenue,
  seatedMatches,
} from '../../helpers/factories.js';
import { must } from '../../helpers/must.js';
import { truncateAll } from '../../helpers/truncate.js';

let app: ReturnType<typeof createAdminServer>;

/**
 * A running single-elimination race-to-3 tournament of 4 players with one
 * table and a referee. In single_day mode the first match is called to the
 * table, the second waits in the queue.
 */
async function running(
  opts: { scheduleMode?: ITournamentScheduleMode; visibility?: 'private' } = {},
) {
  const venue = await createVenue();
  const referee = await createUser();
  const tournament = await createTournament({
    venueId: venue.id,
    status: 'registration_closed',
    winScore: 3,
    scheduleMode: opts.scheduleMode ?? 'single_day',
    visibility: opts.visibility ?? 'public',
  });
  const table = must(
    (
      await db
        .insert(tables)
        .values({ name: 'Стол 1', venueId: venue.id })
        .returning()
    )[0],
    'table',
  );
  await db
    .insert(tournamentTables)
    .values({ tournamentId: tournament.id, tableId: table.id, position: 0 });

  const playerIds: UUID[] = [];
  for (let i = 0; i < 4; i++) {
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

  await startTournamentFull(tournament.id, bot.api);
  return { tournament, referee, venue, tableId: table.id, playerIds };
}

/** First-round matches in bracket order. */
async function roundOne(tournamentId: UUID) {
  return db.query.matches.findMany({
    where: and(eq(matches.tournamentId, tournamentId), eq(matches.round, 1)),
    orderBy: asc(matches.position),
  });
}

async function calledMatch(tournamentId: UUID) {
  return must((await seatedMatches(tournamentId))[0], 'called match');
}

async function waitingMatch(tournamentId: UUID) {
  return must(
    (await roundOne(tournamentId)).find(
      (m) => m.status === 'scheduled' && m.calledAt === null,
    ),
    'waiting match',
  );
}

async function linkExtraTable(venueId: UUID, tournamentId: UUID) {
  const table = must(
    (
      await db.insert(tables).values({ name: 'Стол 2', venueId }).returning()
    )[0],
    'table',
  );
  await db
    .insert(tournamentTables)
    .values({ tournamentId, tableId: table.id, position: 1 });
  return table.id;
}

function call<T = { data?: unknown; error?: string }>(
  method: string,
  path: string,
  userId: UUID | null,
  body?: unknown,
) {
  return apiRequest<T>(app, method, `/api/app/referee${path}`, {
    ...(userId ? { cookie: appCookie(userId) } : {}),
    ...(body !== undefined ? { body } : {}),
  });
}

async function status(matchId: UUID) {
  return must(await getMatch(matchId), 'match').status;
}

describe('app referee router', () => {
  beforeAll(() => {
    vi.spyOn(bot.api, 'sendMessage').mockResolvedValue(
      {} as Awaited<ReturnType<typeof bot.api.sendMessage>>,
    );
  });

  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  describe('access', () => {
    it('401 without a session', async () => {
      const { status: code } = await call('GET', '/tournaments', null);
      expect(code).toBe(401);
    });

    it('GET /tournaments lists only the referee tournaments', async () => {
      const { tournament, referee } = await running();
      await running(); // someone else's

      const { status: code, body } = await call<{
        data: { tournaments: { id: string }[]; attention: unknown[] };
      }>('GET', '/tournaments', referee.id);
      expect(code).toBe(200);
      expect(body.data.tournaments.map((t) => t.id)).toEqual([tournament.id]);
      expect(body.data.attention).toEqual([]);

      const stranger = await createUser();
      const other = await call<{ data: { tournaments: unknown[] } }>(
        'GET',
        '/tournaments',
        stranger.id,
      );
      expect(other.body.data.tournaments).toEqual([]);
    });

    it('board: referee 200, stranger 403, unknown 404, bad id 400', async () => {
      const { tournament, referee } = await running();
      const stranger = await createUser();

      const ok = await call<{
        data: {
          tournament: { id: string };
          matches: { id: string }[];
          tables: { name: string }[];
          absent: unknown[];
        };
      }>('GET', `/tournaments/${tournament.id}/board`, referee.id);
      expect(ok.status).toBe(200);
      expect(ok.body.data.tournament.id).toBe(tournament.id);
      expect(ok.body.data.matches.length).toBeGreaterThan(0);
      expect(ok.body.data.tables.map((t) => t.name)).toEqual(['Стол 1']);
      expect(ok.body.data.absent).toEqual([]);

      expect(
        (await call('GET', `/tournaments/${tournament.id}/board`, stranger.id))
          .status,
      ).toBe(403);
      expect(
        (
          await call(
            'GET',
            '/tournaments/00000000-0000-4000-8000-000000000000/board',
            referee.id,
          )
        ).status,
      ).toBe(404);
      expect(
        (await call('GET', '/tournaments/nope/board', referee.id)).status,
      ).toBe(400);
    });

    it('a referee of one tournament cannot touch another', async () => {
      const a = await running();
      const b = await running();
      const bMatch = await calledMatch(b.tournament.id);

      expect(
        (await call('GET', `/matches/${bMatch.id}`, a.referee.id)).status,
      ).toBe(403);
      expect(
        (await call('POST', `/matches/${bMatch.id}/start`, a.referee.id))
          .status,
      ).toBe(403);
      expect(
        (
          await call(
            'PUT',
            `/tournaments/${b.tournament.id}/queue`,
            a.referee.id,
            {
              matchIds: [bMatch.id],
              expectedMatchIds: [bMatch.id],
            },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call(
            'POST',
            `/tournaments/${b.tournament.id}/participants/${must(b.playerIds[0], 'p')}/present`,
            a.referee.id,
          )
        ).status,
      ).toBe(403);
      expect(await status(bMatch.id)).toBe('scheduled');
    });

    it('an admin may act on any tournament', async () => {
      const { tournament } = await running();
      const admin = await createAdminUser();
      const m = await calledMatch(tournament.id);

      const { status: code } = await call(
        'POST',
        `/matches/${m.id}/start`,
        admin.id,
      );
      expect(code).toBe(200);
      expect(await status(m.id)).toBe('in_progress');
    });

    it('409 when the tournament is not running', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      await db
        .update(tournaments)
        .set({ status: 'registration_closed' })
        .where(eq(tournaments.id, tournament.id));

      const res = await call('POST', `/matches/${m.id}/start`, referee.id);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Турнир не идёт');
      // Reading is still fine.
      expect((await call('GET', `/matches/${m.id}`, referee.id)).status).toBe(
        200,
      );
    });

    it('a referee may judge their own match', async () => {
      const { tournament } = await running();
      const m = await calledMatch(tournament.id);
      const player = must(m.player1Id, 'p1');
      await db
        .insert(tournamentReferees)
        .values({ tournamentId: tournament.id, userId: player });

      const res = await call('POST', `/matches/${m.id}/result`, player, {
        player1Score: 3,
        player2Score: 0,
      });
      expect(res.status).toBe(200);
      const after = must(await getMatch(m.id), 'match');
      expect(after.status).toBe('completed');
      expect(after.winnerId).toBe(player);
    });

    it('a referee sees their private tournament on the player site', async () => {
      const { tournament, referee } = await running({ visibility: 'private' });
      const stranger = await createUser();
      const path = `/api/app/tournaments/${tournament.id}`;

      expect(
        (await apiRequest(app, 'GET', path, { cookie: appCookie(referee.id) }))
          .status,
      ).toBe(200);
      expect(
        (await apiRequest(app, 'GET', path, { cookie: appCookie(stranger.id) }))
          .status,
      ).toBe(404);

      const m = await calledMatch(tournament.id);
      expect(
        (
          await apiRequest(app, 'GET', `/api/app/matches/${m.id}`, {
            cookie: appCookie(referee.id),
          })
        ).status,
      ).toBe(200);
    });
  });

  describe('match actions', () => {
    it('GET /matches/:id returns the match, length, frames and tables', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      const { status: code, body } = await call<{
        data: {
          match: { id: string };
          winScore: number;
          frames: unknown[];
          tables: { id: string }[];
          tournament: { scheduleMode: string };
        };
      }>('GET', `/matches/${m.id}`, referee.id);
      expect(code).toBe(200);
      expect(body.data.match.id).toBe(m.id);
      expect(body.data.winScore).toBe(3);
      expect(body.data.frames).toEqual([]);
      expect(body.data.tables).toHaveLength(1);
      expect(body.data.tournament.scheduleMode).toBe('single_day');
    });

    it('result: final at once, advances the winner', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);

      const res = await call<{ data: { wasDisputed: boolean } }>(
        'POST',
        `/matches/${m.id}/result`,
        referee.id,
        { player1Score: 3, player2Score: 1 },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.wasDisputed).toBe(false);

      const after = must(await getMatch(m.id), 'match');
      expect(after.status).toBe('completed');
      expect(after.winnerId).toBe(m.player1Id);
    });

    it('result: invalid score → 400 with the service message', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      const res = await call('POST', `/matches/${m.id}/result`, referee.id, {
        player1Score: 3,
        player2Score: 3,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Оба игрока не могут выиграть');
    });

    it('a disputed match shows up in attention and is closed by a result', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      const p1 = must(m.player1Id, 'p1');
      const p2 = must(m.player2Id, 'p2');
      expect((await reportResult(m.id, p1, 3, 0)).success).toBe(true);
      expect((await disputeResult(m.id, p2)).success).toBe(true);

      const overview = await call<{
        data: {
          attention: {
            reason: string;
            tournamentName: string;
            match: { id: string; disputedScore: string };
          }[];
        };
      }>('GET', '/tournaments', referee.id);
      expect(overview.body.data.attention).toHaveLength(1);
      const [item] = overview.body.data.attention;
      expect(item?.reason).toBe('disputed');
      expect(item?.tournamentName).toBe(tournament.name);
      expect(item?.match.id).toBe(m.id);
      expect(item?.match.disputedScore).toBe('3:0');

      const res = await call<{ data: { wasDisputed: boolean } }>(
        'POST',
        `/matches/${m.id}/result`,
        referee.id,
        { player1Score: 2, player2Score: 3 },
      );
      expect(res.body.data.wasDisputed).toBe(true);
      expect(
        (
          await call<{ data: { attention: unknown[] } }>(
            'GET',
            '/tournaments',
            referee.id,
          )
        ).body.data.attention,
      ).toEqual([]);
    });

    it('result-frames stores the breakdown', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      const win = { player1Points: 60, player2Points: 10 };
      const res = await call(
        'POST',
        `/matches/${m.id}/result-frames`,
        referee.id,
        {
          frames: [win, win, win],
        },
      );
      expect(res.status).toBe(200);

      const detail = await call<{ data: { frames: unknown[] } }>(
        'GET',
        `/matches/${m.id}`,
        referee.id,
      );
      expect(detail.body.data.frames).toHaveLength(3);
    });

    it('frame drafts: save and undo', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      const saved = await call<{ data: unknown[] }>(
        'PUT',
        `/matches/${m.id}/frames/1`,
        referee.id,
        { player1Points: 50, player2Points: 20 },
      );
      expect(saved.status).toBe(200);
      expect(saved.body.data).toHaveLength(1);

      const undone = await call<{ data: unknown[] }>(
        'DELETE',
        `/matches/${m.id}/frames/last`,
        referee.id,
      );
      expect(undone.status).toBe(200);
      expect(undone.body.data).toEqual([]);
    });

    it('technical: winner by slot, default reason', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      const res = await call('POST', `/matches/${m.id}/technical`, referee.id, {
        winnerSlot: 2,
      });
      expect(res.status).toBe(200);
      const after = must(await getMatch(m.id), 'match');
      expect(after.winnerId).toBe(m.player2Id);
      expect(after.technicalReason).toBe('Решение судьи');
    });

    it('technical: bad slot → 400', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      const res = await call('POST', `/matches/${m.id}/technical`, referee.id, {
        winnerSlot: 3,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Выберите победителя');
    });

    it('ready by slot: the second mark starts the match', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);

      const first = await call<{ data: { started: boolean } }>(
        'POST',
        `/matches/${m.id}/ready`,
        referee.id,
        { slot: 1 },
      );
      expect(first.body.data.started).toBe(false);
      const second = await call<{ data: { started: boolean } }>(
        'POST',
        `/matches/${m.id}/ready`,
        referee.id,
        { slot: 2 },
      );
      expect(second.body.data.started).toBe(true);
      expect(await status(m.id)).toBe('in_progress');
    });

    it('extend-call, then postpone a called match', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      const before = must(m.callDeadlineAt, 'deadline').getTime();

      expect(
        (await call('POST', `/matches/${m.id}/extend-call`, referee.id)).status,
      ).toBe(200);
      const extended = must(await getMatch(m.id), 'match');
      expect(
        must(extended.callDeadlineAt, 'deadline').getTime(),
      ).toBeGreaterThan(before);

      expect(
        (await call('POST', `/matches/${m.id}/postpone`, referee.id)).status,
      ).toBe(200);
      const board = await call<{ data: { absent: { userId: string }[] } }>(
        'GET',
        `/tournaments/${tournament.id}/board`,
        referee.id,
      );
      expect(board.body.data.absent.map((a) => a.userId).sort()).toEqual(
        [m.player1Id, m.player2Id].sort(),
      );

      // Both back: «На месте».
      for (const userId of [m.player1Id, m.player2Id]) {
        const res = await call<{ data: { wasAbsent: boolean } }>(
          'POST',
          `/tournaments/${tournament.id}/participants/${must(userId, 'p')}/present`,
          referee.id,
        );
        expect(res.body.data.wasAbsent).toBe(true);
      }
    });

    it('no-show: technical loss for the absent slot', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      const res = await call('POST', `/matches/${m.id}/no-show`, referee.id, {
        absentSlot: 1,
      });
      expect(res.status).toBe(200);
      const after = must(await getMatch(m.id), 'match');
      expect(after.status).toBe('completed');
      expect(after.winnerId).toBe(m.player2Id);
    });

    it('table: 409 while another match holds it, force takes it', async () => {
      const { tournament, referee, tableId } = await running();
      const holder = await calledMatch(tournament.id);
      const waiting = await waitingMatch(tournament.id);

      const blocked = await call(
        'PUT',
        `/matches/${waiting.id}/table`,
        referee.id,
        {
          tableId,
        },
      );
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toMatch(/^Стол занят матчем/);

      const forced = await call(
        'PUT',
        `/matches/${waiting.id}/table`,
        referee.id,
        {
          tableId,
          force: true,
        },
      );
      expect(forced.status).toBe(200);
      expect(must(await getMatch(waiting.id), 'match').tableId).toBe(tableId);
      expect(must(await getMatch(holder.id), 'match').tableId).toBeNull();
    });

    it('call: a waiting match to a free table', async () => {
      const { tournament, referee, venue } = await running();
      const waiting = await waitingMatch(tournament.id);
      const extra = await linkExtraTable(venue.id, tournament.id);

      const res = await call(
        'POST',
        `/matches/${waiting.id}/call`,
        referee.id,
        {
          tableId: extra,
        },
      );
      expect(res.status).toBe(200);
      const after = must(await getMatch(waiting.id), 'match');
      expect(after.tableId).toBe(extra);
      expect(after.calledAt).not.toBeNull();
    });

    it('queue: reorder the waiting matches', async () => {
      const { tournament, referee } = await running();
      // The whole waiting set (scheduled, no table) — the final included.
      const waiting = await db.query.matches.findMany({
        where: and(
          eq(matches.tournamentId, tournament.id),
          eq(matches.status, 'scheduled'),
          isNull(matches.tableId),
        ),
        orderBy: [asc(matches.round), asc(matches.position)],
      });
      const seen = waiting.map((m) => m.id);
      const reversed = [...seen].reverse();

      const res = await call(
        'PUT',
        `/tournaments/${tournament.id}/queue`,
        referee.id,
        { matchIds: reversed, expectedMatchIds: seen },
      );
      expect(res.status).toBe(200);
      const after = await db.query.matches.findMany({
        where: eq(matches.tournamentId, tournament.id),
      });
      const order = new Map(after.map((m) => [m.id, m.queueOrder]));
      expect(reversed.map((id) => order.get(id))).toEqual(
        reversed.map((_, i) => i),
      );

      const stale = await call(
        'PUT',
        `/tournaments/${tournament.id}/queue`,
        referee.id,
        { matchIds: reversed.slice(1), expectedMatchIds: reversed },
      );
      expect(stale.status).toBe(400);

      // A full list built on the order before the reorder is stale too.
      const outdated = await call(
        'PUT',
        `/tournaments/${tournament.id}/queue`,
        referee.id,
        { matchIds: seen, expectedMatchIds: seen },
      );
      expect(outdated.status).toBe(400);
      expect(outdated.body.error).toBe(
        'Очередь изменилась — обновите страницу',
      );
    });

    it('schedule: 409 outside per_match', async () => {
      const { tournament, referee } = await running();
      const m = await calledMatch(tournament.id);
      const res = await call('PUT', `/matches/${m.id}/schedule`, referee.id, {
        scheduledAt: new Date().toISOString(),
      });
      expect(res.status).toBe(409);
    });

    it('schedule: set and clear in per_match', async () => {
      const { tournament, referee } = await running({
        scheduleMode: 'per_match',
      });
      const m = must((await roundOne(tournament.id))[0], 'match');
      const at = '2026-11-01T15:30:00.000Z';

      const set = await call('PUT', `/matches/${m.id}/schedule`, referee.id, {
        scheduledAt: at,
      });
      expect(set.status).toBe(200);
      expect(
        must(await getMatch(m.id), 'match').scheduledAt?.toISOString(),
      ).toBe(at);

      const cleared = await call(
        'PUT',
        `/matches/${m.id}/schedule`,
        referee.id,
        {
          scheduledAt: null,
        },
      );
      expect(cleared.status).toBe(200);
      expect(must(await getMatch(m.id), 'match').scheduledAt).toBeNull();
    });
  });
});
