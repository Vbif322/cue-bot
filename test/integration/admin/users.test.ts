import type { UUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';
import { db } from '@/db/db.js';
import { loginTokens, matches, tournaments, users } from '@/db/schema.js';
import type { ApiUserStats } from '@/bot/@types/user.js';
import { DELETED_USERNAME } from '@/services/userService.js';

import { apiRequest } from '../../helpers/auth.js';
import {
  createAdminUser,
  createConfirmedParticipant,
  createLoginToken,
  createMatchesForTournament,
  createTournament,
  createUser,
} from '../../helpers/factories.js';
import { must } from '../../helpers/must.js';
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
    // Personal data must never be exposed via the API.
    expect(body.data.every((u) => !('birthday' in u))).toBe(true);
  });

  it('GET /:id returns a single user without personal data', async () => {
    const user = await createUser();
    const { status, body } = await apiRequest<{ data: UserRow }>(
      app,
      'GET',
      `/api/users/${user.id}`,
      { user: admin },
    );
    expect(status).toBe(200);
    expect(body.data.id).toBe(user.id);
    expect(body.data).toHaveProperty('username');
    expect(body.data).not.toHaveProperty('birthday');
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

  describe('DELETE /:id (anonymize)', () => {
    it('tombstones a user but preserves their tournament and matches', async () => {
      // Target user creates a tournament and plays (and wins) a match in it.
      const target = await createUser({
        username: 'target',
        telegram_id: '555',
        name: 'Иван',
        surname: 'Петров',
        phone: '+70000000000',
        email: 'i@p.test',
      });
      const tournament = await createTournament({
        createdBy: target.id,
        status: 'registration_open',
        format: 'single_elimination',
      });
      await createConfirmedParticipant(tournament.id, {
        seed: 1,
        userId: target.id,
      });
      await createConfirmedParticipant(tournament.id, { seed: 2 });
      const created = await createMatchesForTournament(
        tournament.id,
        'single_elimination',
      );
      const match = must(created[0], 'match');
      await createLoginToken(target.id);

      const { status, body } = await apiRequest<{ ok: boolean }>(
        app,
        'DELETE',
        `/api/users/${target.id}`,
        { user: admin },
      );
      expect(status).toBe(200);
      expect(body).toEqual({ ok: true });

      // Row is kept, but anonymized.
      const row = must(
        await db.query.users.findFirst({ where: eq(users.id, target.id) }),
        'anonymized user row',
      );
      expect(row.username).toBe(DELETED_USERNAME);
      expect(row.telegram_id).toBeNull();
      expect(row.name).toBeNull();
      expect(row.surname).toBeNull();
      expect(row.phone).toBeNull();
      expect(row.email).toBeNull();
      expect(row.role).toBe('user');
      expect(row.deletedAt).not.toBeNull();

      // Tournament and match still reference the (now anonymized) user.
      const t = await db.query.tournaments.findFirst({
        where: eq(tournaments.id, tournament.id),
      });
      expect(t?.createdBy).toBe(target.id);
      const m = await db.query.matches.findFirst({
        where: eq(matches.id, match.id),
      });
      expect(m?.player1Id).toBe(target.id);

      // Login tokens are revoked.
      const tokens = await db.query.loginTokens.findMany({
        where: eq(loginTokens.userId, target.id),
      });
      expect(tokens).toEqual([]);
    });

    it('GET / hides tombstoned users but keeps active ones', async () => {
      const active = await createUser({ username: 'still_here' });
      const doomed = await createUser({ username: 'doomed' });

      await apiRequest(app, 'DELETE', `/api/users/${doomed.id}`, {
        user: admin,
      });

      const { status, body } = await apiRequest<{ data: UserRow[] }>(
        app,
        'GET',
        '/api/users',
        { user: admin },
      );
      expect(status).toBe(200);
      const ids = body.data.map((u) => u.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(doomed.id);
    });

    it('rejects self-deletion (400)', async () => {
      const { status, body } = await apiRequest<{ error: string }>(
        app,
        'DELETE',
        `/api/users/${admin.id}`,
        { user: admin },
      );
      expect(status).toBe(400);
      expect(body).toEqual({ error: 'Нельзя удалить собственный аккаунт' });
    });

    it('returns 404 for an unknown user', async () => {
      const { status } = await apiRequest(
        app,
        'DELETE',
        '/api/users/00000000-0000-0000-0000-000000000000',
        { user: admin },
      );
      expect(status).toBe(404);
    });

    it('is idempotent on an already-tombstoned user', async () => {
      const user = await createUser();
      await apiRequest(app, 'DELETE', `/api/users/${user.id}`, { user: admin });
      const { status, body } = await apiRequest<{ ok: boolean }>(
        app,
        'DELETE',
        `/api/users/${user.id}`,
        { user: admin },
      );
      expect(status).toBe(200);
      expect(body).toEqual({ ok: true });
    });
  });
});
