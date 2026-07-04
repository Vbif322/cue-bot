import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import { createUser } from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

let app: ReturnType<typeof createAdminServer>;

describe('app me router', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('GET / отдаёт профиль с emailVerified=false (telegram-юзер)', async () => {
    const user = await createUser({ name: 'Иван' });
    const { status, body } = await apiRequest<{
      data: { id: string; name: string | null; emailVerified: boolean };
    }>(app, 'GET', '/api/app/me', { cookie: appCookie(user.id) });

    expect(status).toBe(200);
    expect(body.data.id).toBe(user.id);
    expect(body.data.name).toBe('Иван');
    expect(body.data.emailVerified).toBe(false);
  });

  it('PATCH / обновляет имя/фамилию', async () => {
    const user = await createUser();
    const { status, body } = await apiRequest<{
      data: { name: string | null; surname: string | null };
    }>(app, 'PATCH', '/api/app/me', {
      cookie: appCookie(user.id),
      body: { name: 'Пётр', surname: 'Иванов' },
    });

    expect(status).toBe(200);
    expect(body.data.name).toBe('Пётр');
    expect(body.data.surname).toBe('Иванов');
  });

  it('PATCH / отклоняет слишком длинное имя → 400', async () => {
    const user = await createUser();
    const { status } = await apiRequest(app, 'PATCH', '/api/app/me', {
      cookie: appCookie(user.id),
      body: { name: 'x'.repeat(200) },
    });
    expect(status).toBe(400);
  });

  it('GET /matches отдаёт активные и историю', async () => {
    const user = await createUser();
    const { status, body } = await apiRequest<{
      data: { active: unknown[]; history: unknown[] };
    }>(app, 'GET', '/api/app/me/matches', { cookie: appCookie(user.id) });

    expect(status).toBe(200);
    expect(Array.isArray(body.data.active)).toBe(true);
    expect(Array.isArray(body.data.history)).toBe(true);
  });

  it('GET /stats отдаёт статистику матчей и историю турниров', async () => {
    const user = await createUser();
    const { status, body } = await apiRequest<{
      data: { matches: { played: number }; tournamentHistory: unknown[] };
    }>(app, 'GET', '/api/app/me/stats', { cookie: appCookie(user.id) });

    expect(status).toBe(200);
    expect(body.data.matches.played).toBe(0);
    expect(Array.isArray(body.data.tournamentHistory)).toBe(true);
  });

  it('требует входа → 401', async () => {
    const { status } = await apiRequest(app, 'GET', '/api/app/me');
    expect(status).toBe(401);
  });
});
