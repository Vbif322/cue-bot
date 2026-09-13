import { randomUUID } from 'crypto';
import type { UUID } from 'crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { db } from '@/db/db.js';
import { tournamentParticipants } from '@/db/schema.js';
import { createAdminServer } from '@/admin/server/index.js';
import { bot } from '@/bot/instance.js';
import type {
  ITournamentSport,
  ITournamentDiscipline,
} from '@/shared/tournament/disciplines.js';

import { apiRequest } from '../../helpers/auth.js';
import { must } from '../../helpers/must.js';
import {
  createAdminUser,
  createMatchesForTournament,
  createTournament,
  createTournamentWithParticipants,
  createUser,
  createVenue,
} from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';
import { registerGroupChat } from '@/services/groupChatService.js';

const app = createAdminServer();

interface TournamentRow {
  id: UUID;
  name: string;
  status: string;
  createdBy: UUID;
  sport: ITournamentSport;
  discipline: ITournamentDiscipline;
}

describe('admin tournaments router', () => {
  let admin: Awaited<ReturnType<typeof createAdminUser>>;
  let sendMessageSpy: MockInstance;

  beforeAll(() => {
    // Status changes / participant actions fan out Telegram notifications;
    // stub the transport so tests never touch the network.
    sendMessageSpy = vi
      .spyOn(bot.api, 'sendMessage')
      .mockResolvedValue({ message_id: 1 } as Awaited<
        ReturnType<typeof bot.api.sendMessage>
      >);
    // Анонс в группы читает имя бота для deep-link'а — без стаба getMe ушёл бы
    // в сеть и рассылка молча свернулась бы.
    vi.spyOn(bot.api, 'getMe').mockResolvedValue({
      id: 42,
      is_bot: true,
      first_name: 'Cue',
      username: 'cue_bot',
    } as Awaited<ReturnType<typeof bot.api.getMe>>);
  });

  beforeEach(async () => {
    await truncateAll();
    admin = await createAdminUser();
  });

  it('requires authentication (401)', async () => {
    const { status } = await apiRequest(app, 'GET', '/api/tournaments');
    expect(status).toBe(401);
  });

  it('GET / lists tournaments including drafts', async () => {
    const t = await createTournament({ status: 'draft' });
    const { status, body } = await apiRequest<{ data: TournamentRow[] }>(
      app,
      'GET',
      '/api/tournaments',
      { user: admin },
    );
    expect(status).toBe(200);
    expect(body.data.map((x) => x.id)).toContain(t.id);
  });

  it('GET /:id returns the tournament, 404 when unknown', async () => {
    const t = await createTournament();
    const found = await apiRequest<{ data: TournamentRow }>(
      app,
      'GET',
      `/api/tournaments/${t.id}`,
      { user: admin },
    );
    expect(found.body.data.id).toBe(t.id);

    const missing = await apiRequest<{ error: string }>(
      app,
      'GET',
      '/api/tournaments/00000000-0000-0000-0000-000000000000',
      { user: admin },
    );
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Не найден' });
  });

  it('GET /:id/tables, /:id/participants, /:id/stats return arrays/objects', async () => {
    const t = await createTournament();
    const tables = await apiRequest<{ data: unknown[] }>(
      app,
      'GET',
      `/api/tournaments/${t.id}/tables`,
      { user: admin },
    );
    expect(tables.body.data).toEqual([]);

    const participants = await apiRequest<{ data: unknown[] }>(
      app,
      'GET',
      `/api/tournaments/${t.id}/participants`,
      { user: admin },
    );
    expect(participants.body.data).toEqual([]);

    const stats = await apiRequest<{ data: { total: number } }>(
      app,
      'GET',
      `/api/tournaments/${t.id}/stats`,
      { user: admin },
    );
    expect(stats.body.data).toHaveProperty('total');
  });

  it('POST / creates a draft owned by the admin', async () => {
    const venue = await createVenue();
    const { status, body } = await apiRequest<{ data: TournamentRow }>(
      app,
      'POST',
      '/api/tournaments',
      {
        user: admin,
        body: {
          name: 'Кубок',
          sport: 'snooker',
          discipline: 'snooker_15_red',
          format: 'single_elimination',
          venueId: venue.id,
        },
      },
    );
    expect(status).toBe(201);
    expect(body.data.name).toBe('Кубок');
    expect(body.data.createdBy).toBe(admin.id);
    expect(body.data.sport).toBe('snooker');
    expect(body.data.discipline).toBe('snooker_15_red');
  });

  it('POST / rejects a discipline of another sport (400)', async () => {
    const venue = await createVenue();
    const { status } = await apiRequest(app, 'POST', '/api/tournaments', {
      user: admin,
      body: {
        name: 'X',
        sport: 'snooker',
        discipline: 'pool_9',
        format: 'single_elimination',
        venueId: venue.id,
      },
    });
    expect(status).toBe(400);
  });

  it('POST / rejects an invalid format (400)', async () => {
    const venue = await createVenue();
    const { status } = await apiRequest(app, 'POST', '/api/tournaments', {
      user: admin,
      body: {
        name: 'X',
        sport: 'snooker',
        discipline: 'snooker_15_red',
        format: 'bogus',
        venueId: venue.id,
      },
    });
    expect(status).toBe(400);
  });

  it('PATCH /:id edits a draft', async () => {
    const venue = await createVenue();
    const t = await createTournament({ status: 'draft', venueId: venue.id });
    const { status, body } = await apiRequest<{ data: TournamentRow }>(
      app,
      'PATCH',
      `/api/tournaments/${t.id}`,
      {
        user: admin,
        body: {
          name: 'Новое имя',
          sport: 'snooker',
          discipline: 'snooker_15_red',
          format: 'single_elimination',
          venueId: venue.id,
        },
      },
    );
    expect(status).toBe(200);
    expect(body.data.name).toBe('Новое имя');
  });

  it('PATCH /:id rejects editing a started tournament (400)', async () => {
    const venue = await createVenue();
    const t = await createTournament({
      status: 'in_progress',
      venueId: venue.id,
    });
    const { status } = await apiRequest(
      app,
      'PATCH',
      `/api/tournaments/${t.id}`,
      {
        user: admin,
        body: {
          name: 'X',
          format: 'single_elimination',
          venueId: venue.id,
        },
      },
    );
    expect(status).toBe(400);
  });

  it('PATCH /:id/status cancels a tournament', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const { status, body } = await apiRequest<{ data: TournamentRow }>(
      app,
      'PATCH',
      `/api/tournaments/${t.id}/status`,
      { user: admin, body: { status: 'cancelled' } },
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('cancelled');
  });

  it('PATCH /:id/status opens registration on a draft', async () => {
    const t = await createTournament({ status: 'draft' });
    const { status, body } = await apiRequest<{ data: TournamentRow }>(
      app,
      'PATCH',
      `/api/tournaments/${t.id}/status`,
      { user: admin, body: { status: 'registration_open' } },
    );
    expect(status).toBe(200);
    expect(body.data.status).toBe('registration_open');
  });

  it('PATCH /:id/status announces the open registration to subscribed groups', async () => {
    const sendMessage = sendMessageSpy;
    sendMessage.mockClear();

    await registerGroupChat({
      chatId: '-1001',
      type: 'supergroup',
      title: 'Клуб',
      addedBy: null,
    });
    const t = await createTournament({
      status: 'draft',
      visibility: 'public',
    });

    const { status } = await apiRequest(
      app,
      'PATCH',
      `/api/tournaments/${t.id}/status`,
      { user: admin, body: { status: 'registration_open' } },
    );
    expect(status).toBe(200);

    // Рассылка идёт fire-and-forget уже после ответа роута — без waitFor тест
    // был бы флакающим.
    await vi.waitFor(() => {
      expect(sendMessage.mock.calls.some((call) => call[0] === '-1001')).toBe(
        true,
      );
    });
  });

  it('PATCH /:id/status does not announce a private tournament', async () => {
    const sendMessage = sendMessageSpy;
    sendMessage.mockClear();

    await registerGroupChat({
      chatId: '-1002',
      type: 'supergroup',
      title: 'Клуб',
      addedBy: null,
    });
    const t = await createTournament({
      status: 'draft',
      visibility: 'private',
    });

    await apiRequest(app, 'PATCH', `/api/tournaments/${t.id}/status`, {
      user: admin,
      body: { status: 'registration_open' },
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sendMessage.mock.calls.some((call) => call[0] === '-1002')).toBe(
      false,
    );
  });

  it('PATCH /:id/status refuses to re-open an already open tournament', async () => {
    const t = await createTournament({ status: 'registration_open' });
    const { status } = await apiRequest(
      app,
      'PATCH',
      `/api/tournaments/${t.id}/status`,
      { user: admin, body: { status: 'registration_open' } },
    );
    expect(status).toBe(400);
  });

  it('PATCH /:id/status rejects rolling a completed tournament back to draft', async () => {
    const t = await createTournament({ status: 'completed' });
    const { status } = await apiRequest(
      app,
      'PATCH',
      `/api/tournaments/${t.id}/status`,
      { user: admin, body: { status: 'draft' } },
    );
    expect(status).toBe(400);
  });

  it('PATCH /:id/status rejects setting in_progress manually', async () => {
    const t = await createTournament({ status: 'registration_closed' });
    const { status } = await apiRequest(
      app,
      'PATCH',
      `/api/tournaments/${t.id}/status`,
      { user: admin, body: { status: 'in_progress' } },
    );
    expect(status).toBe(400);
  });

  it('DELETE /:id removes a draft but refuses a started tournament', async () => {
    const draft = await createTournament({ status: 'draft' });
    const okDelete = await apiRequest<{ ok: boolean }>(
      app,
      'DELETE',
      `/api/tournaments/${draft.id}`,
      { user: admin },
    );
    expect(okDelete.status).toBe(200);
    expect(okDelete.body).toEqual({ ok: true });

    const started = await createTournament({ status: 'in_progress' });
    const refused = await apiRequest(
      app,
      'DELETE',
      `/api/tournaments/${started.id}`,
      { user: admin },
    );
    expect(refused.status).toBe(400);
  });

  describe('participants', () => {
    it('adds an external participant, visible in the list', async () => {
      const t = await createTournament({ status: 'registration_open' });
      const add = await apiRequest<{ ok: boolean }>(
        app,
        'POST',
        `/api/tournaments/${t.id}/participants`,
        { user: admin, body: { type: 'external', name: 'Гость' } },
      );
      expect(add.status).toBe(200);

      const list = await apiRequest<{
        data: { name: string | null }[];
      }>(app, 'GET', `/api/tournaments/${t.id}/participants`, { user: admin });
      expect(list.body.data.map((p) => p.name)).toContain('Гость');
    });

    it('confirms a pending participant during registration', async () => {
      const t = await createTournament({ status: 'registration_open' });
      const user = await createUser();
      await db.insert(tournamentParticipants).values({
        tournamentId: t.id,
        userId: user.id,
        status: 'pending',
      });

      const { status, body } = await apiRequest<{ ok: boolean }>(
        app,
        'PATCH',
        `/api/tournaments/${t.id}/participants/${user.id}`,
        { user: admin, body: { action: 'confirm' } },
      );
      expect(status).toBe(200);
      expect(body).toEqual({ ok: true });
    });

    it('rejects participant actions outside registration (400)', async () => {
      const t = await createTournament({ status: 'in_progress' });
      const user = await createUser();
      const { status } = await apiRequest(
        app,
        'PATCH',
        `/api/tournaments/${t.id}/participants/${user.id}`,
        { user: admin, body: { action: 'confirm' } },
      );
      expect(status).toBe(400);
    });

    it('sets a participant seed and randomizes seeds', async () => {
      const t = await createTournament({ status: 'registration_open' });
      const user = await createUser();
      await db.insert(tournamentParticipants).values({
        tournamentId: t.id,
        userId: user.id,
        status: 'confirmed',
      });

      const seed = await apiRequest<{ ok: boolean }>(
        app,
        'PATCH',
        `/api/tournaments/${t.id}/participants/${user.id}/seed`,
        { user: admin, body: { seed: 1 } },
      );
      expect(seed.status).toBe(200);

      const randomize = await apiRequest<{ ok: boolean }>(
        app,
        'POST',
        `/api/tournaments/${t.id}/participants/seeds/randomize`,
        { user: admin },
      );
      expect(randomize.status).toBe(200);
    });

    it('removes a participant', async () => {
      const t = await createTournament({ status: 'registration_open' });
      const user = await createUser();
      await db.insert(tournamentParticipants).values({
        tournamentId: t.id,
        userId: user.id,
        status: 'confirmed',
      });

      const { status } = await apiRequest(
        app,
        'DELETE',
        `/api/tournaments/${t.id}/participants/${user.id}`,
        { user: admin },
      );
      expect(status).toBe(200);
    });
  });

  describe('GET /:id/standings', () => {
    interface StandingsRow {
      userId: UUID;
      rank: number;
      wins: number;
      name: string | null;
      clinched: boolean;
    }
    interface StandingsGroup {
      groupIndex: number;
      pointsComplete: boolean;
      rows: StandingsRow[];
    }

    it('returns the single table of a round-robin tournament', async () => {
      const { tournament, participantIds } =
        await createTournamentWithParticipants(3, 'round_robin');
      await createMatchesForTournament(tournament.id, 'round_robin');

      const { status, body } = await apiRequest<{ data: StandingsGroup[] }>(
        app,
        'GET',
        `/api/tournaments/${tournament.id}/standings`,
        { user: admin },
      );
      expect(status).toBe(200);
      expect(body.data).toHaveLength(1);
      const table = must(body.data[0], 'standings');
      expect(table.groupIndex).toBe(0);
      expect(table.rows.map((r) => r.userId)).toEqual(participantIds);
      // No qualification out of a round robin, so nobody is ever marked.
      expect(table.rows.every((r) => !r.clinched)).toBe(true);
    });

    it('returns an empty list for an elimination format', async () => {
      const t = await createTournament({ format: 'single_elimination' });

      const { status, body } = await apiRequest<{ data: StandingsGroup[] }>(
        app,
        'GET',
        `/api/tournaments/${t.id}/standings`,
        { user: admin },
      );
      expect(status).toBe(200);
      expect(body.data).toEqual([]);
    });

    it('404s for an unknown tournament', async () => {
      const { status } = await apiRequest(
        app,
        'GET',
        `/api/tournaments/${randomUUID()}/standings`,
        { user: admin },
      );
      expect(status).toBe(404);
    });
  });
});
