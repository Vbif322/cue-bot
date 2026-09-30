import type { UUID } from 'crypto';

import type { Api } from 'grammy';

import { and, asc, eq } from 'drizzle-orm';
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
  setMatchTable,
  startMatch,
} from '@/services/matchService.js';
import { startTournamentFull } from '@/services/tournamentStartService.js';
import { getTournament } from '@/services/tournamentService.js';

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

const UNFINISHED = new Set([
  'scheduled',
  'in_progress',
  'pending_confirmation',
]);

const GROUP_CONFIG = {
  groupsCount: 2,
  participantsPerGroup: 4,
  qualifiersPerGroup: 2,
  groupDraw: 'snake' as const,
};

/** Insert a table at the tournament's venue and link it at `position`. */
async function linkTable(
  tournamentId: UUID,
  venueId: UUID,
  position: number,
): Promise<UUID> {
  const [table] = await db
    .insert(tables)
    .values({ name: `Стол ${String(position + 1)}`, venueId })
    .returning();
  const tableId = must(table, 'table').id;
  await db.insert(tournamentTables).values({ tournamentId, tableId, position });
  return tableId;
}

/** A startable 8-player tournament with `tableCount` linked tables. */
async function setupTournament(format: ITournamentFormat, tableCount: number) {
  const venue = await createVenue();
  const tournament = await createTournament({
    venueId: venue.id,
    status: 'registration_closed',
    format,
    winScore: 3,
    ...(format === 'groups_playoff' ? GROUP_CONFIG : {}),
  });

  const tableIds: UUID[] = [];
  for (let i = 0; i < tableCount; i++) {
    tableIds.push(await linkTable(tournament.id, venue.id, i));
  }

  for (let seed = 1; seed <= 8; seed++) {
    const user = await createUser();
    await db.insert(tournamentParticipants).values({
      tournamentId: tournament.id,
      userId: user.id,
      status: 'confirmed',
      seed,
    });
  }

  return { tournament, venueId: venue.id, tableIds };
}

async function allMatches(tournamentId: UUID): Promise<MatchRow[]> {
  return db.query.matches.findMany({
    where: eq(matches.tournamentId, tournamentId),
    orderBy: [asc(matches.round), asc(matches.position)],
  });
}

async function liveMatches(tournamentId: UUID): Promise<MatchRow[]> {
  return db.query.matches.findMany({
    where: and(
      eq(matches.tournamentId, tournamentId),
      eq(matches.status, 'in_progress'),
    ),
    orderBy: [asc(matches.round), asc(matches.position)],
  });
}

/**
 * The table-assignment contract, checked after every step of a run:
 * one unfinished match per table, every live match seated at one of the
 * tournament's tables, no player at two tables, and no table left idle while a
 * playable match is waiting for one.
 */
async function assertTableInvariants(
  tournamentId: UUID,
  tableIds: UUID[],
  opts: { allowIdle?: boolean } = {},
): Promise<void> {
  const rows = await allMatches(tournamentId);

  const holders = new Map<UUID, UUID>();
  for (const m of rows) {
    if (m.tableId === null || !UNFINISHED.has(m.status)) continue;
    expect(
      holders.get(m.tableId),
      `стол ${m.tableId} занят двумя незавершёнными матчами`,
    ).toBeUndefined();
    holders.set(m.tableId, m.id);
  }

  const playing = new Set<UUID>();
  for (const m of rows.filter((r) => r.status === 'in_progress')) {
    expect(tableIds).toContain(m.tableId);
    for (const id of [m.player1Id, m.player2Id]) {
      const playerId = must(id, 'player id');
      expect(playing.has(playerId), `игрок ${playerId} за двумя столами`).toBe(
        false,
      );
      playing.add(playerId);
    }
  }

  if (opts.allowIdle) return;
  const freeTables = tableIds.filter((id) => !holders.has(id));
  if (freeTables.length > 0) {
    expect(
      await getNextReadyMatch(tournamentId),
      'свободный стол простаивает, хотя есть готовый матч',
    ).toBeNull();
  }
}

/**
 * Play the tournament to completion the way the bot does: only matches that
 * were seated automatically are played (player1 wins), and every confirmation
 * goes through `botApi` so the freed table is handed on. Stalling with no live
 * match means a table was never handed out.
 */
async function playOutWithTables(
  tournamentId: UUID,
  tableIds: UUID[],
  botApi: Api,
): Promise<{ maxConcurrent: number; usedTables: Set<UUID> }> {
  let maxConcurrent = 0;
  const usedTables = new Set<UUID>();

  for (let step = 0; step < 300; step++) {
    if ((await getTournament(tournamentId))?.status === 'completed') break;

    const live = await liveMatches(tournamentId);
    maxConcurrent = Math.max(maxConcurrent, live.length);
    const [next] = live;
    if (!next) {
      throw new Error(
        'нет матчей в игре, а турнир не завершён: столы простаивают',
      );
    }
    usedTables.add(must(next.tableId, 'tableId'));

    await completeMatch(next.id, must(next.player1Id, 'player1Id'), botApi);
    await assertTableInvariants(tournamentId, tableIds);
  }

  expect((await getTournament(tournamentId))?.status).toBe('completed');
  return { maxConcurrent, usedTables };
}

/** Every match that was actually played (not a walkover) sat at a table. */
async function expectAllPlayedAtTables(tournamentId: UUID): Promise<void> {
  const played = (await allMatches(tournamentId)).filter(
    (m) => m.status === 'completed' && m.technicalReason === null,
  );
  expect(played.length).toBeGreaterThan(0);
  for (const m of played) expect(m.tableId).not.toBeNull();
}

describe('table assignment', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  describe('full run with automatic assignment (enough tables)', () => {
    it('double elimination: seats R1 on all tables and plays out', async () => {
      const { tournament, tableIds } = await setupTournament(
        'double_elimination',
        4,
      );
      const botApi = createMockBotApi() as unknown as Api;
      await startTournamentFull(tournament.id, botApi);

      const live = await liveMatches(tournament.id);
      expect(live).toHaveLength(4);
      expect(new Set(live.map((m) => m.tableId))).toEqual(new Set(tableIds));
      await assertTableInvariants(tournament.id, tableIds);

      const { usedTables } = await playOutWithTables(
        tournament.id,
        tableIds,
        botApi,
      );
      expect(usedTables).toEqual(new Set(tableIds));
      await expectAllPlayedAtTables(tournament.id);
    });

    it('groups + playoff: seats the group phase, then the playoff by itself', async () => {
      const { tournament, tableIds } = await setupTournament(
        'groups_playoff',
        4,
      );
      const botApi = createMockBotApi() as unknown as Api;
      await startTournamentFull(tournament.id, botApi);

      // 2 groups × 4 players → 2 disjoint matches per group can run at once.
      expect(await liveMatches(tournament.id)).toHaveLength(4);
      await assertTableInvariants(tournament.id, tableIds);

      let sawPlayoffSeated = false;
      for (let step = 0; step < 100; step++) {
        const [next] = await liveMatches(tournament.id);
        if (next?.phase !== 'group') break;
        await completeMatch(next.id, must(next.player1Id, 'player1Id'), botApi);
        await assertTableInvariants(tournament.id, tableIds);
        const live = await liveMatches(tournament.id);
        if (live.some((m) => m.phase === 'playoff')) {
          sawPlayoffSeated = true;
          // The playoff only starts once every group match is done.
          const groupOpen = (await allMatches(tournament.id)).filter(
            (m) => m.phase === 'group' && m.status !== 'completed',
          );
          expect(groupOpen).toHaveLength(0);
          break;
        }
      }
      expect(sawPlayoffSeated).toBe(true);

      await playOutWithTables(tournament.id, tableIds, botApi);
      await expectAllPlayedAtTables(tournament.id);
    });
  });

  describe('more matches than tables', () => {
    for (const format of ['double_elimination', 'groups_playoff'] as const) {
      for (const tableCount of [1, 2]) {
        it(`${format}, ${String(tableCount)} table(s): queues matches and hands freed tables on`, async () => {
          const { tournament, tableIds } = await setupTournament(
            format,
            tableCount,
          );
          const botApi = createMockBotApi() as unknown as Api;
          await startTournamentFull(tournament.id, botApi);

          const live = await liveMatches(tournament.id);
          expect(live).toHaveLength(tableCount);
          const waiting = (await allMatches(tournament.id)).filter(
            (m) =>
              m.status === 'scheduled' &&
              m.player1Id !== null &&
              m.player2Id !== null,
          );
          expect(waiting.length).toBeGreaterThan(0);
          for (const m of waiting) expect(m.tableId).toBeNull();
          await assertTableInvariants(tournament.id, tableIds);

          // The table freed by the first finished match goes to the next in queue.
          const first = must(live[0], 'first live match');
          const expectedNext = must(
            await getNextReadyMatch(tournament.id),
            'queued match',
          );
          await completeMatch(first.id, must(first.player1Id, 'p1'), botApi);
          const seated = must(
            (await allMatches(tournament.id)).find(
              (m) => m.id === expectedNext.id,
            ),
            'queued match row',
          );
          expect(seated.status).toBe('in_progress');
          expect(seated.tableId).toBe(first.tableId);
          await assertTableInvariants(tournament.id, tableIds);

          const { maxConcurrent, usedTables } = await playOutWithTables(
            tournament.id,
            tableIds,
            botApi,
          );
          expect(maxConcurrent).toBeLessThanOrEqual(tableCount);
          expect(usedTables).toEqual(new Set(tableIds));
          await expectAllPlayedAtTables(tournament.id);
        });
      }
    }
  });

  describe('manual assignment by the admin', () => {
    it('moving a live match to another table frees the old one on the next completion', async () => {
      const { tournament, venueId, tableIds } = await setupTournament(
        'double_elimination',
        2,
      );
      const botApi = createMockBotApi() as unknown as Api;
      await startTournamentFull(tournament.id, botApi);
      const [t1, t2] = tableIds as [UUID, UUID];

      // A third table is added mid-tournament and the admin moves match 1 there.
      const t3 = await linkTable(tournament.id, venueId, 2);
      const allTables = [t1, t2, t3];
      const [m1] = await liveMatches(tournament.id);
      const moved = must(m1, 'm1');
      expect(moved.tableId).toBe(t1);

      expect(await setMatchTable(moved.id, t3)).toEqual({ success: true });
      const afterMove = must(
        (await allMatches(tournament.id)).find((m) => m.id === moved.id),
        'moved row',
      );
      expect(afterMove.tableId).toBe(t3);
      expect(afterMove.status).toBe('in_progress');
      // A manual move doesn't redistribute tables by itself: t1 waits for the
      // next completion.
      await assertTableInvariants(tournament.id, allTables, {
        allowIdle: true,
      });

      await completeMatch(moved.id, must(moved.player1Id, 'p1'), botApi);
      // The completion drains every free table: the freed t3 first, then t1.
      const live = await liveMatches(tournament.id);
      expect(live).toHaveLength(3);
      expect(new Set(live.map((m) => m.tableId))).toEqual(
        new Set([t1, t2, t3]),
      );
      await assertTableInvariants(tournament.id, allTables);

      await playOutWithTables(tournament.id, allTables, botApi);
    });

    it('taking a busy table unseats the match that held it', async () => {
      const { tournament, tableIds } = await setupTournament(
        'double_elimination',
        2,
      );
      await startTournamentFull(
        tournament.id,
        createMockBotApi() as unknown as Api,
      );
      const t1 = must(tableIds[0], 't1');

      const holder = must(
        (await liveMatches(tournament.id)).find((m) => m.tableId === t1),
        'holder of t1',
      );
      const queued = must(await getNextReadyMatch(tournament.id), 'queued');

      expect(await setMatchTable(queued.id, t1)).toEqual({ success: true });

      const rows = await allMatches(tournament.id);
      const holderAfter = must(
        rows.find((m) => m.id === holder.id),
        'holder row',
      );
      const queuedAfter = must(
        rows.find((m) => m.id === queued.id),
        'queued row',
      );
      expect(holderAfter.tableId).toBeNull();
      expect(holderAfter.status).toBe('in_progress');
      expect(queuedAfter.tableId).toBe(t1);
      // The override only sets the table; it doesn't start the match.
      expect(queuedAfter.status).toBe('scheduled');
    });

    it('a table assigned to a not-yet-started match is not handed to another match', async () => {
      const { tournament, venueId, tableIds } = await setupTournament(
        'double_elimination',
        2,
      );
      const botApi = createMockBotApi() as unknown as Api;
      await startTournamentFull(tournament.id, botApi);

      // A third table appears and the admin reserves it for the last R1 match.
      const t3 = await linkTable(tournament.id, venueId, 2);
      const allTables = [...tableIds, t3];
      const reserved = must(
        (await allMatches(tournament.id))
          .filter(
            (m) =>
              m.status === 'scheduled' &&
              m.player1Id !== null &&
              m.player2Id !== null,
          )
          .at(-1),
        'queued match',
      );
      expect(await setMatchTable(reserved.id, t3)).toEqual({ success: true });
      await assertTableInvariants(tournament.id, allTables);

      // Finish everything that is currently live: each completion frees a table
      // and makes new matches ready, which must not be seated at t3.
      for (const live of await liveMatches(tournament.id)) {
        await completeMatch(live.id, must(live.player1Id, 'p1'), botApi);
        await assertTableInvariants(tournament.id, allTables);
      }
      for (const live of await liveMatches(tournament.id)) {
        await completeMatch(live.id, must(live.player1Id, 'p1'), botApi);
        await assertTableInvariants(tournament.id, allTables);
      }

      const reservedRow = must(
        (await allMatches(tournament.id)).find((m) => m.id === reserved.id),
        'reserved row',
      );
      // Auto-start skips a match the admin already seated: it waits for the admin.
      expect(reservedRow.status).toBe('scheduled');
      expect(reservedRow.tableId).toBe(t3);

      const started = await startMatch(reserved.id);
      expect(started.success).toBe(true);
      expect(started.match?.tableId).toBe(t3);
      await assertTableInvariants(tournament.id, allTables);

      await playOutWithTables(tournament.id, allTables, botApi);
    });

    it('rejects a table that is not linked to the tournament and can clear a table', async () => {
      const { tournament, venueId } = await setupTournament(
        'double_elimination',
        2,
      );
      await startTournamentFull(
        tournament.id,
        createMockBotApi() as unknown as Api,
      );
      const [live] = await liveMatches(tournament.id);
      const match = must(live, 'live match');

      const [foreign] = await db
        .insert(tables)
        .values({ name: 'Чужой стол', venueId })
        .returning();
      expect(
        await setMatchTable(match.id, must(foreign, 'foreign').id),
      ).toEqual({ success: false, error: 'Стол не принадлежит турниру' });

      expect(await setMatchTable(match.id, null)).toEqual({ success: true });
      const cleared = must(
        (await allMatches(tournament.id)).find((m) => m.id === match.id),
        'cleared row',
      );
      expect(cleared.tableId).toBeNull();
      expect(cleared.status).toBe('in_progress');
    });
  });
});
