import type { UUID } from 'crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';
import { bot } from '@/bot/instance.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import {
  createTournament,
  createConfirmedParticipant,
  createUser,
} from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

// Свежий сервер на каждый тест — сбрасывает пер-IP лимитеры внутри роутеров.
let app: ReturnType<typeof createAdminServer>;

describe('app tournaments router', () => {
  beforeAll(() => {
    vi.spyOn(bot.api, 'sendMessage').mockResolvedValue(
      {} as Awaited<ReturnType<typeof bot.api.sendMessage>>,
    );
  });

  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  describe('GET / (лента)', () => {
    it('содержит только публичные не-черновики', async () => {
      const open = await createTournament({
        status: 'registration_open',
        visibility: 'public',
      });
      const draft = await createTournament({
        status: 'draft',
        visibility: 'public',
      });
      const priv = await createTournament({
        status: 'registration_open',
        visibility: 'private',
      });

      const { status, body } = await apiRequest<{
        data: { id: UUID }[];
      }>(app, 'GET', '/api/app/tournaments');

      expect(status).toBe(200);
      const ids = body.data.map((t) => t.id);
      expect(ids).toContain(open.id);
      expect(ids).not.toContain(draft.id);
      expect(ids).not.toContain(priv.id);
    });

    it('публичный — доступен без входа', async () => {
      const { status } = await apiRequest(app, 'GET', '/api/app/tournaments');
      expect(status).toBe(200);
    });
  });

  describe('GET /:id (видимость)', () => {
    it('private невидим не-участнику → 404', async () => {
      const priv = await createTournament({
        status: 'registration_open',
        visibility: 'private',
      });
      const stranger = await createUser();

      const { status } = await apiRequest(
        app,
        'GET',
        `/api/app/tournaments/${priv.id}`,
        { cookie: appCookie(stranger.id) },
      );
      expect(status).toBe(404);
    });

    it('private виден участнику → 200 с флагом isParticipant', async () => {
      const priv = await createTournament({
        status: 'registration_open',
        visibility: 'private',
      });
      const player = await createUser();
      await createConfirmedParticipant(priv.id, { userId: player.id });

      const { status, body } = await apiRequest<{
        data: { isParticipant: boolean; participationStatus: string | null };
      }>(app, 'GET', `/api/app/tournaments/${priv.id}`, {
        cookie: appCookie(player.id),
      });
      expect(status).toBe(200);
      expect(body.data.isParticipant).toBe(true);
      expect(body.data.participationStatus).toBe('confirmed');
    });

    it('невалидный UUID в path → 400 (zod), не 500', async () => {
      const { status } = await apiRequest(
        app,
        'GET',
        '/api/app/tournaments/not-a-uuid',
      );
      expect(status).toBe(400);
    });
  });

  describe('register / cancel', () => {
    it('регистрация при закрытой регистрации → 409 с сообщением', async () => {
      const closed = await createTournament({
        status: 'registration_closed',
        visibility: 'public',
      });
      const player = await createUser();

      const { status, body } = await apiRequest<{ error: string }>(
        app,
        'POST',
        `/api/app/tournaments/${closed.id}/register`,
        { cookie: appCookie(player.id) },
      );
      expect(status).toBe(409);
      expect(body.error).toBe('Регистрация на турнир закрыта');
    });

    it('cancel → повторная регистрация проходит', async () => {
      const open = await createTournament({
        status: 'registration_open',
        visibility: 'public',
      });
      const player = await createUser();
      const cookie = appCookie(player.id);
      const path = `/api/app/tournaments/${open.id}`;

      const first = await apiRequest(app, 'POST', `${path}/register`, { cookie });
      expect(first.status).toBe(200);

      const cancel = await apiRequest(app, 'POST', `${path}/cancel`, { cookie });
      expect(cancel.status).toBe(200);

      const again = await apiRequest<{ data: { status: string } }>(
        app,
        'POST',
        `${path}/register`,
        { cookie },
      );
      expect(again.status).toBe(200);
      expect(again.body.data.status).toBe('pending');
    });

    it('регистрация требует входа → 401', async () => {
      const open = await createTournament({ status: 'registration_open' });
      const { status } = await apiRequest(
        app,
        'POST',
        `/api/app/tournaments/${open.id}/register`,
      );
      expect(status).toBe(401);
    });
  });
});
