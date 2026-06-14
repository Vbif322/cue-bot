import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';
import type { ApiUserStats } from '@/bot/@types/user.js';

import { apiRequest } from '../../helpers/auth.js';
import {
  createAdminUser,
  createTournament,
  createUser,
} from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

const app = createAdminServer();

interface UserRow {
  id: UUID;
  username: string;
  name: string | null;
  surname: string | null;
  role: string;
}

describe('admin users router', () => {
  let admin: Awaited<ReturnType<typeof createAdminUser>>;

  beforeEach(async () => {
    await truncateAll();
    admin = await createAdminUser();
  });

  it('GET / lists users sorted by username', async () => {
    await createUser({ username: 'zoe' });
    await createUser({ username: 'amy' });

    const { status, body } = await apiRequest<{ data: UserRow[] }>(
      app,
      'GET',
      '/api/users',
      { user: admin },
    );

    expect(status).toBe(200);
    const usernames = body.data.map((u) => u.username);
    expect(usernames).toContain('amy');
    expect(usernames).toContain('zoe');
    // Globally sorted ascending.
    expect([...usernames]).toEqual([...usernames].sort((a, b) => a.localeCompare(b)));
  });

  it('GET /:id returns a single user', async () => {
    const user = await createUser();
    const { status, body } = await apiRequest<{ data: UserRow }>(
      app,
      'GET',
      `/api/users/${user.id}`,
      { user: admin },
    );
    expect(status).toBe(200);
    expect(body.data.id).toBe(user.id);
  });

  it('GET /:id returns 404 for an unknown user', async () => {
    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'GET',
      '/api/users/00000000-0000-0000-0000-000000000000',
      { user: admin },
    );
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Не найден' });
  });

  it('GET /:id/stats returns the aggregated stats shape', async () => {
    const user = await createUser();
    const { status, body } = await apiRequest<{ data: ApiUserStats }>(
      app,
      'GET',
      `/api/users/${user.id}/stats`,
      { user: admin },
    );
    expect(status).toBe(200);
    expect(body.data).toHaveProperty('matches');
    expect(body.data.tournamentHistory).toEqual([]);
    expect(body.data.refereeTournaments).toEqual([]);
  });

  it('PATCH /:id updates name and surname', async () => {
    const user = await createUser();
    const { status, body } = await apiRequest<{ data: UserRow }>(
      app,
      'PATCH',
      `/api/users/${user.id}`,
      { user: admin, body: { name: 'Иван', surname: 'Петров' } },
    );
    expect(status).toBe(200);
    expect(body.data.name).toBe('Иван');
    expect(body.data.surname).toBe('Петров');
  });

  it('PATCH /:id rejects an over-length name (400)', async () => {
    const user = await createUser();
    const { status } = await apiRequest(app, 'PATCH', `/api/users/${user.id}`, {
      user: admin,
      body: { name: 'x'.repeat(51) },
    });
    expect(status).toBe(400);
  });

  it('PATCH /:id/role promotes a user to admin', async () => {
    const user = await createUser();
    const { status, body } = await apiRequest<{ data: UserRow }>(
      app,
      'PATCH',
      `/api/users/${user.id}/role`,
      { user: admin, body: { role: 'admin' } },
    );
    expect(status).toBe(200);
    expect(body.data.role).toBe('admin');
  });

  it('PATCH /:id/role rejects self role change (400)', async () => {
    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'PATCH',
      `/api/users/${admin.id}/role`,
      { user: admin, body: { role: 'user' } },
    );
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Нельзя изменить собственную роль' });
  });

  it('PATCH /:id/role rejects an invalid role (400)', async () => {
    const user = await createUser();
    const { status } = await apiRequest(
      app,
      'PATCH',
      `/api/users/${user.id}/role`,
      { user: admin, body: { role: 'superuser' } },
    );
    expect(status).toBe(400);
  });

  it('assigns and removes a referee, reflected in stats', async () => {
    const user = await createUser();
    const tournament = await createTournament();

    const assign = await apiRequest<{ ok: boolean }>(
      app,
      'POST',
      `/api/users/${user.id}/referee`,
      { user: admin, body: { tournamentId: tournament.id } },
    );
    expect(assign.status).toBe(200);
    expect(assign.body).toEqual({ ok: true });

    const afterAssign = await apiRequest<{ data: ApiUserStats }>(
      app,
      'GET',
      `/api/users/${user.id}/stats`,
      { user: admin },
    );
    expect(afterAssign.body.data.refereeTournaments.map((t) => t.id)).toEqual([
      tournament.id,
    ]);

    const remove = await apiRequest<{ ok: boolean }>(
      app,
      'DELETE',
      `/api/users/${user.id}/referee/${tournament.id}`,
      { user: admin },
    );
    expect(remove.status).toBe(200);

    const afterRemove = await apiRequest<{ data: ApiUserStats }>(
      app,
      'GET',
      `/api/users/${user.id}/stats`,
      { user: admin },
    );
    expect(afterRemove.body.data.refereeTournaments).toEqual([]);
  });
});
