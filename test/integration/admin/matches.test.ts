import type { UUID } from 'crypto';

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';
import { db } from '@/db/db.js';
import { matches, notifications, tables } from '@/db/schema.js';
import { getMatch, reportResult } from '@/services/matchService.js';

import { apiRequest } from '../../helpers/auth.js';
import {
  createAdminUser,
  createMatchesForTournament,
  createTournament,
  createTournamentWithParticipants,
} from '../../helpers/factories.js';
import { must } from '../../helpers/must.js';
import { truncateAll } from '../../helpers/truncate.js';

const app = createAdminServer();

// S7-1 covers only the HTTP wrapper of the matches router — auth, routing,
// validation and 404s. The stateful business logic (report/confirm/dispute/
// technical/correct/advance + full RR / SE-bye run-throughs) is exercised on
// the service layer in S7-2.

describe('admin matches router (HTTP layer)', () => {
  let admin: Awaited<ReturnType<typeof createAdminUser>>;

  beforeEach(async () => {
    await truncateAll();
    admin = await createAdminUser();
  });

  it('requires authentication (401)', async () => {
    const { status } = await apiRequest(
      app,
      'GET',
      '/api/matches/00000000-0000-0000-0000-000000000000',
    );
    expect(status).toBe(401);
  });

  it('GET /tournament/:id returns an empty list before start', async () => {
    const t = await createTournament();
    const { status, body } = await apiRequest<{ data: unknown[] }>(
      app,
      'GET',
      `/api/matches/tournament/${t.id}`,
      { user: admin },
    );
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it('GET /tournament/:id/stats returns the stats shape', async () => {
    const t = await createTournament();
    const { status, body } = await apiRequest<{ data: { total: number } }>(
      app,
      'GET',
      `/api/matches/tournament/${t.id}/stats`,
      { user: admin },
    );
    expect(status).toBe(200);
    expect(body.data).toHaveProperty('total');
  });

  it('GET /:id returns 404 for an unknown match', async () => {
    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'GET',
      '/api/matches/00000000-0000-0000-0000-000000000000',
      { user: admin },
    );
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Матч не найден' });
  });

  const validId = '00000000-0000-0000-0000-000000000000';

  it('POST /:id/report rejects an invalid body (400)', async () => {
    const { status } = await apiRequest(
      app,
      'POST',
      `/api/matches/${validId}/report`,
      { user: admin, body: { reporterId: 'not-a-uuid', player1Score: 3 } },
    );
    expect(status).toBe(400);
  });

  it('POST /:id/confirm rejects a missing confirmerId (400)', async () => {
    const { status } = await apiRequest(
      app,
      'POST',
      `/api/matches/${validId}/confirm`,
      { user: admin, body: {} },
    );
    expect(status).toBe(400);
  });

  it('POST /:id/technical rejects a missing reason (400)', async () => {
    const { status } = await apiRequest(
      app,
      'POST',
      `/api/matches/${validId}/technical`,
      { user: admin, body: { winnerId: validId } },
    );
    expect(status).toBe(400);
  });

  it('PUT /:id/table rejects a non-uuid, non-null tableId (400)', async () => {
    const { status } = await apiRequest(
      app,
      'PUT',
      `/api/matches/${validId}/table`,
      { user: admin, body: { tableId: 'nope' } },
    );
    expect(status).toBe(400);
  });

  it('PUT /:id/schedule rejects a non-ISO datetime (400)', async () => {
    const { status } = await apiRequest(
      app,
      'PUT',
      `/api/matches/${validId}/schedule`,
      { user: admin, body: { scheduledAt: 'tomorrow' } },
    );
    expect(status).toBe(400);
  });

  it('PUT /tournament/:id/queue rejects an empty or non-uuid list (400)', async () => {
    const t = await createTournament();
    for (const matchIds of [[], ['nope'], undefined]) {
      const { status } = await apiRequest(
        app,
        'PUT',
        `/api/matches/tournament/${t.id}/queue`,
        { user: admin, body: { matchIds, expectedMatchIds: matchIds } },
      );
      expect(status).toBe(400);
    }
  });

  it('PUT /tournament/:id/queue surfaces the service error (400)', async () => {
    const t = await createTournament({ status: 'registration_closed' });
    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'PUT',
      `/api/matches/tournament/${t.id}/queue`,
      {
        user: admin,
        body: { matchIds: [validId], expectedMatchIds: [validId] },
      },
    );
    expect(status).toBe(400);
    expect(body.error).toBe('Очередь можно менять только в идущем турнире');
  });

  it('POST /:id/start returns 400 for an unknown match', async () => {
    const { status } = await apiRequest(
      app,
      'POST',
      `/api/matches/${validId}/start`,
      { user: admin },
    );
    expect(status).toBe(400);
  });

  it('POST /:id/ready marks players present for them; the second starts the match', async () => {
    const { tournament } = await createTournamentWithParticipants(
      2,
      'single_elimination',
    );
    const [created] = await createMatchesForTournament(
      tournament.id,
      'single_elimination',
    );
    const match = must(created, 'match');
    const [table] = await db
      .insert(tables)
      .values({ name: 'Стол 1', venueId: tournament.venueId })
      .returning();
    const now = new Date();
    await db
      .update(matches)
      .set({
        tableId: must(table, 'table').id,
        calledAt: now,
        callDeadlineAt: new Date(now.getTime() + 10 * 60_000),
      })
      .where(eq(matches.id, match.id));

    const ready = (userId: string | null) =>
      apiRequest<{ data: { started: boolean } }>(
        app,
        'POST',
        `/api/matches/${match.id}/ready`,
        { user: admin, body: { userId } },
      );

    const first = await ready(match.player1Id);
    expect(first.status).toBe(200);
    expect(first.body.data.started).toBe(false);

    const second = await ready(match.player2Id);
    expect(second.status).toBe(200);
    expect(second.body.data.started).toBe(true);
    expect((await getMatch(match.id))?.status).toBe('in_progress');
  });

  it('POST /:id/ready rejects a missing userId (400)', async () => {
    const { status } = await apiRequest(
      app,
      'POST',
      `/api/matches/${validId}/ready`,
      { user: admin, body: {} },
    );
    expect(status).toBe(400);
  });
  describe('result notifications', () => {
    /** A 2-player match with p1's 3:0 report pending. */
    async function pendingMatch() {
      const { tournament } = await createTournamentWithParticipants(
        2,
        'single_elimination',
        { winScore: 3 },
      );
      const [match] = await createMatchesForTournament(
        tournament.id,
        'single_elimination',
      );
      const m = must(match, 'match');
      const p1 = must(m.player1Id, 'p1');
      const p2 = must(m.player2Id, 'p2');
      expect((await reportResult(m.id, p1, 3, 0)).success).toBe(true);
      return { matchId: m.id, p1, p2, createdBy: tournament.createdBy };
    }

    async function titles(userId: UUID) {
      const rows = await db.query.notifications.findMany({
        where: eq(notifications.userId, userId),
      });
      return rows.map((n) => n.title);
    }

    it('confirm notifies both players', async () => {
      const { matchId, p1, p2 } = await pendingMatch();
      const { status } = await apiRequest(
        app,
        'POST',
        `/api/matches/${matchId}/confirm`,
        { user: admin, body: { confirmerId: p2 } },
      );
      expect(status).toBe(200);
      for (const player of [p1, p2]) {
        expect(await titles(player)).toContain('Результат подтверждён');
      }
    });

    it('dispute notifies the players and the decision maker', async () => {
      const { matchId, p1, p2, createdBy } = await pendingMatch();
      const { status } = await apiRequest(
        app,
        'POST',
        `/api/matches/${matchId}/dispute`,
        { user: admin },
      );
      expect(status).toBe(200);
      for (const player of [p1, p2]) {
        expect(await titles(player)).toContain('Результат оспорен');
      }
      const after = must(
        await db.query.matches.findFirst({ where: eq(matches.id, matchId) }),
        'match',
      );
      expect(after.disputedBy).toBe(admin.id);
      // No referee assigned → the creator decides.
      expect(await titles(createdBy)).toEqual(['Спор по результату']);
    });
  });
});
