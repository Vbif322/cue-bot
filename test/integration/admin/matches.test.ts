import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';

import { apiRequest } from '../../helpers/auth.js';
import { createAdminUser, createTournament } from '../../helpers/factories.js';
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

  it('POST /:id/start returns 400 for an unknown match', async () => {
    const { status } = await apiRequest(
      app,
      'POST',
      `/api/matches/${validId}/start`,
      { user: admin },
    );
    expect(status).toBe(400);
  });
});
