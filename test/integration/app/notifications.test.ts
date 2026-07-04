import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';
import { createNotification } from '@/services/notificationService.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import { createUser } from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

let app: ReturnType<typeof createAdminServer>;

async function notifyUser(userId: UUID, isRead = false): Promise<UUID> {
  const id = await createNotification({
    userId,
    type: 'match_reminder',
    title: 'Тест',
    message: 'Сообщение',
  });
  // createNotification вставляет непрочитанное; при необходимости пометим read.
  if (isRead) {
    await apiRequest(app, 'POST', `/api/app/notifications/${id}/read`, {
      cookie: appCookie(userId),
    });
  }
  return id;
}

describe('app notifications router', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('markAsRead чужого уведомления → 404', async () => {
    const owner = await createUser();
    const other = await createUser();
    const id = await notifyUser(owner.id);

    const { status } = await apiRequest(
      app,
      'POST',
      `/api/app/notifications/${id}/read`,
      { cookie: appCookie(other.id) },
    );
    expect(status).toBe(404);
  });

  it('markAsRead своего уведомления → 200 и оно исчезает из непрочитанных', async () => {
    const owner = await createUser();
    const cookie = appCookie(owner.id);
    const id = await notifyUser(owner.id);

    const read = await apiRequest(
      app,
      'POST',
      `/api/app/notifications/${id}/read`,
      { cookie },
    );
    expect(read.status).toBe(200);

    const { body } = await apiRequest<{ data: { id: UUID }[] }>(
      app,
      'GET',
      '/api/app/notifications?unread=1',
      { cookie },
    );
    expect(body.data.map((n) => n.id)).not.toContain(id);
  });

  it('read-all помечает все прочитанными', async () => {
    const owner = await createUser();
    const cookie = appCookie(owner.id);
    await notifyUser(owner.id);
    await notifyUser(owner.id);

    const all = await apiRequest(app, 'POST', '/api/app/notifications/read-all', {
      cookie,
    });
    expect(all.status).toBe(200);

    const { body } = await apiRequest<{ data: unknown[] }>(
      app,
      'GET',
      '/api/app/notifications?unread=1',
      { cookie },
    );
    expect(body.data).toHaveLength(0);
  });

  it('список отдаёт только свои уведомления', async () => {
    const owner = await createUser();
    const other = await createUser();
    await notifyUser(owner.id);
    await notifyUser(other.id);

    const { status, body } = await apiRequest<{ data: { userId: UUID }[] }>(
      app,
      'GET',
      '/api/app/notifications',
      { cookie: appCookie(owner.id) },
    );
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.userId).toBe(owner.id);
  });

  it('требует входа → 401', async () => {
    const { status } = await apiRequest(app, 'GET', '/api/app/notifications');
    expect(status).toBe(401);
  });
});
