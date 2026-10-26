import type { UUID } from 'crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';
import { bot } from '@/bot/instance.js';
import { db } from '@/db/db.js';
import { tables } from '@/db/schema.js';
import { setOrganizerUntil } from '@/services/federationService.js';
import {
  bindGroupChat,
  getGroupChat,
  registerGroupChat,
} from '@/services/groupChatService.js';

import { apiRequest } from '../../helpers/auth.js';
import {
  createAdminUser,
  createConfirmedParticipant,
  createFederation,
  createMatchesForTournament,
  createOrganizer,
  createTournament,
  createTournamentWithParticipants,
  createUser,
  createVenue,
  grantUntil,
} from '../../helpers/factories.js';
import { must } from '../../helpers/must.js';
import { truncateAll } from '../../helpers/truncate.js';

const app = createAdminServer();

interface Row {
  id: UUID;
  [k: string]: unknown;
}

describe('admin panel: federation scoping', () => {
  let admin: Awaited<ReturnType<typeof createAdminUser>>;
  let fedA: Awaited<ReturnType<typeof createFederation>>;
  let fedB: Awaited<ReturnType<typeof createFederation>>;
  let organizerA: Awaited<ReturnType<typeof createOrganizer>>;

  let sendMessageSpy: MockInstance;

  beforeAll(() => {
    sendMessageSpy = vi.spyOn(bot.api, 'sendMessage').mockResolvedValue({
      message_id: 1,
    } as Awaited<ReturnType<typeof bot.api.sendMessage>>);
    vi.spyOn(bot.api, 'setMyCommands').mockResolvedValue(true);
  });

  beforeEach(async () => {
    await truncateAll();
    admin = await createAdminUser();
    fedA = await createFederation({ name: 'Лига А', city: 'Москва' });
    fedB = await createFederation({ name: 'Лига Б', city: 'Казань' });
    organizerA = await createOrganizer(fedA.id);
  });

  describe('requireStaff / auth', () => {
    it('admits an organizer (200) and rejects a plain user (403)', async () => {
      const ok = await apiRequest(app, 'GET', '/api/tournaments', {
        user: organizerA,
      });
      expect(ok.status).toBe(200);

      const stranger = await createUser();
      const denied = await apiRequest(app, 'GET', '/api/tournaments', {
        user: stranger,
      });
      expect(denied.status).toBe(403);
    });

    it('GET /api/auth/me reports federations and the platform flag', async () => {
      const me = await apiRequest<{
        user: { id: UUID } | null;
        isPlatformAdmin: boolean;
        federations: { id: UUID; role: string }[];
      }>(app, 'GET', '/api/auth/me', { user: organizerA });
      expect(me.body.user?.id).toBe(organizerA.id);
      expect(me.body.isPlatformAdmin).toBe(false);
      expect(me.body.federations).toMatchObject([
        {
          id: fedA.id,
          name: 'Лига А',
          city: 'Москва',
          role: 'organizer',
        },
      ]);

      const adminMe = await apiRequest<{ isPlatformAdmin: boolean }>(
        app,
        'GET',
        '/api/auth/me',
        { user: admin },
      );
      expect(adminMe.body.isPlatformAdmin).toBe(true);
    });

    it('organizer grant: admin sets/clears it, the holder gets into the panel and is notified', async () => {
      const buyer = await createUser({ telegram_id: '5550001' });
      const until = grantUntil(30).toISOString();

      // без права и членств — не staff
      const before = await apiRequest(app, 'GET', '/api/tournaments', {
        user: buyer,
      });
      expect(before.status).toBe(403);

      const byOrganizer = await apiRequest(
        app,
        'PATCH',
        `/api/users/${buyer.id}/organizer`,
        { user: organizerA, body: { until } },
      );
      expect(byOrganizer.status).toBe(403);

      const past = await apiRequest(
        app,
        'PATCH',
        `/api/users/${buyer.id}/organizer`,
        {
          user: admin,
          body: { until: new Date(Date.now() - 1000).toISOString() },
        },
      );
      expect(past.status).toBe(400);

      sendMessageSpy.mockClear();
      const granted = await apiRequest<{ data: { organizerUntil: string } }>(
        app,
        'PATCH',
        `/api/users/${buyer.id}/organizer`,
        { user: admin, body: { until } },
      );
      expect(granted.status).toBe(200);
      expect(granted.body.data.organizerUntil).toBe(until);
      expect(sendMessageSpy).toHaveBeenCalledWith(
        5550001,
        expect.stringContaining('/new_federation'),
      );

      const me = await apiRequest<{
        user: { id: UUID } | null;
        canCreateFederations: boolean;
        federations: unknown[];
      }>(app, 'GET', '/api/auth/me', { user: buyer });
      expect(me.body.user?.id).toBe(buyer.id);
      expect(me.body.canCreateFederations).toBe(true);
      expect(me.body.federations).toEqual([]);

      // организатор не видит срок чужого права (биллинг)
      const fed = await createFederation({ ownerId: buyer.id });
      await createTournament({ federationId: fed.id });
      const asTeammate = await createOrganizer(fed.id);
      const seen = await apiRequest<{ data: Record<string, unknown> }>(
        app,
        'GET',
        `/api/users/${buyer.id}`,
        { user: asTeammate },
      );
      expect(seen.status).toBe(200);
      expect(seen.body.data).not.toHaveProperty('organizerUntil');

      const cleared = await apiRequest<{
        data: { organizerUntil: string | null };
      }>(app, 'PATCH', `/api/users/${buyer.id}/organizer`, {
        user: admin,
        body: { until: null },
      });
      expect(cleared.body.data.organizerUntil).toBeNull();
    });

    it('an expired federation cannot create tournaments, but keeps managing existing ones', async () => {
      await setOrganizerUntil(fedA.ownerId, new Date(Date.now() - 1000));
      const venue = await createVenue({
        federationId: fedA.id,
        city: 'Москва',
      });
      const res = await apiRequest<{ error: string }>(
        app,
        'POST',
        '/api/tournaments',
        {
          user: organizerA,
          body: {
            name: 'Новый',
            sport: 'snooker',
            discipline: 'snooker_15_red',
            venueId: venue.id,
            federationId: fedA.id,
            format: 'single_elimination',
            maxParticipants: 8,
            winScore: 3,
          },
        },
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/истёк/);

      const existing = await createTournament({
        federationId: fedA.id,
        status: 'draft',
      });
      const opened = await apiRequest(
        app,
        'PATCH',
        `/api/tournaments/${existing.id}/status`,
        { user: organizerA, body: { status: 'registration_open' } },
      );
      expect(opened.status).toBe(200);
    });

    it('role change and user deletion stay admin-only (403 for organizer)', async () => {
      const target = await createUser();
      const role = await apiRequest(
        app,
        'PATCH',
        `/api/users/${target.id}/role`,
        { user: organizerA, body: { role: 'admin' } },
      );
      expect(role.status).toBe(403);
      const del = await apiRequest(app, 'DELETE', `/api/users/${target.id}`, {
        user: organizerA,
      });
      expect(del.status).toBe(403);
    });
  });

  describe('tournaments', () => {
    it('organizer lists only own federation tournaments; admin lists all', async () => {
      const own = await createTournament({ federationId: fedA.id });
      await createTournament({ federationId: fedB.id });
      await createTournament(); // platform

      const mine = await apiRequest<{ data: Row[] }>(
        app,
        'GET',
        '/api/tournaments',
        { user: organizerA },
      );
      expect(mine.body.data.map((t) => t.id)).toEqual([own.id]);

      const all = await apiRequest<{ data: Row[] }>(
        app,
        'GET',
        '/api/tournaments',
        { user: admin },
      );
      expect(all.body.data).toHaveLength(3);

      const platformOnly = await apiRequest<{ data: Row[] }>(
        app,
        'GET',
        '/api/tournaments?federationId=platform',
        { user: admin },
      );
      expect(platformOnly.body.data).toHaveLength(1);

      const foreignFilter = await apiRequest(
        app,
        'GET',
        `/api/tournaments?federationId=${fedB.id}`,
        { user: organizerA },
      );
      expect(foreignFilter.status).toBe(403);
    });

    it('foreign tournament reads/mutations answer 404; a referee can read but not administer', async () => {
      const foreign = await createTournament({
        federationId: fedB.id,
        status: 'draft',
      });
      const read = await apiRequest(
        app,
        'GET',
        `/api/tournaments/${foreign.id}`,
        {
          user: organizerA,
        },
      );
      expect(read.status).toBe(404);
      const patch = await apiRequest(
        app,
        'PATCH',
        `/api/tournaments/${foreign.id}/status`,
        { user: organizerA, body: { status: 'registration_open' } },
      );
      expect(patch.status).toBe(404);
      const del = await apiRequest(
        app,
        'DELETE',
        `/api/tournaments/${foreign.id}`,
        {
          user: organizerA,
        },
      );
      expect(del.status).toBe(404);

      // Судья чужого турнира: читать может, администрировать — нет.
      const referee = await createOrganizer(fedA.id); // staff, but not in fedB
      await apiRequest(app, 'POST', `/api/users/${referee.id}/referee`, {
        user: admin,
        body: { tournamentId: foreign.id },
      });
      const refRead = await apiRequest(
        app,
        'GET',
        `/api/tournaments/${foreign.id}`,
        { user: referee },
      );
      expect(refRead.status).toBe(200);
      const refStatus = await apiRequest(
        app,
        'PATCH',
        `/api/tournaments/${foreign.id}/status`,
        { user: referee, body: { status: 'registration_open' } },
      );
      expect(refStatus.status).toBe(404);
    });

    it('organizer creates in own federation only; venue must belong to it or be shared', async () => {
      const shared = await createVenue({ city: 'Москва' });
      const foreignVenue = await createVenue({ federationId: fedB.id });
      const base = {
        name: 'Кубок',
        sport: 'snooker',
        discipline: 'snooker_15_red',
        format: 'single_elimination',
        maxParticipants: 8,
        winScore: 3,
      };

      const wrongFed = await apiRequest<{ error: string }>(
        app,
        'POST',
        '/api/tournaments',
        {
          user: organizerA,
          body: { ...base, venueId: shared.id, federationId: fedB.id },
        },
      );
      expect(wrongFed.status).toBe(403);

      const noFed = await apiRequest(app, 'POST', '/api/tournaments', {
        user: organizerA,
        body: { ...base, venueId: shared.id },
      });
      expect(noFed.status).toBe(403);

      const badVenue = await apiRequest<{ error: string }>(
        app,
        'POST',
        '/api/tournaments',
        {
          user: organizerA,
          body: { ...base, venueId: foreignVenue.id, federationId: fedA.id },
        },
      );
      expect(badVenue.status).toBe(400);
      expect(badVenue.body.error).toMatch(/другой организации/);

      const ok = await apiRequest<{
        data: { federationId: UUID; federationName: string; venueCity: string };
      }>(app, 'POST', '/api/tournaments', {
        user: organizerA,
        body: { ...base, venueId: shared.id, federationId: fedA.id },
      });
      expect(ok.status).toBe(201);
      expect(ok.body.data.federationId).toBe(fedA.id);
      expect(ok.body.data.federationName).toBe('Лига А');
      expect(ok.body.data.venueCity).toBe('Москва');

      // Админ без federationId создаёт платформенный турнир.
      const platform = await apiRequest<{
        data: { federationId: UUID | null };
      }>(app, 'POST', '/api/tournaments', {
        user: admin,
        body: { ...base, venueId: shared.id },
      });
      expect(platform.status).toBe(201);
      expect(platform.body.data.federationId).toBeNull();
    });

    it('external participants are tagged with the tournament federation', async () => {
      const t = await createTournament({
        federationId: fedA.id,
        status: 'registration_open',
      });
      const res = await apiRequest(
        app,
        'POST',
        `/api/tournaments/${t.id}/participants`,
        { user: organizerA, body: { type: 'external', name: 'Гость' } },
      );
      expect(res.status).toBe(200);
      const guest = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.name, 'Гость'),
      });
      expect(guest?.createdByFederationId).toBe(fedA.id);
    });
  });

  describe('matches', () => {
    it('match routes of a foreign tournament answer 404', async () => {
      const { tournament } = await createTournamentWithParticipants(
        4,
        'single_elimination',
        { federationId: fedB.id },
      );
      const created = await createMatchesForTournament(
        tournament.id,
        'single_elimination',
      );
      const match = must(created[0]);

      const list = await apiRequest(
        app,
        'GET',
        `/api/matches/tournament/${tournament.id}`,
        { user: organizerA },
      );
      expect(list.status).toBe(404);
      const one = await apiRequest(app, 'GET', `/api/matches/${match.id}`, {
        user: organizerA,
      });
      expect(one.status).toBe(404);
      const asAdmin = await apiRequest(app, 'GET', `/api/matches/${match.id}`, {
        user: admin,
      });
      expect(asAdmin.status).toBe(200);
    });
  });

  describe('venues & tables', () => {
    it('organizer sees shared + own venues; shared venues are read-only for them', async () => {
      const shared = await createVenue({ name: 'Общая' });
      const own = await createVenue({ name: 'Своя', federationId: fedA.id });
      await createVenue({ name: 'Чужая', federationId: fedB.id });

      const list = await apiRequest<{ data: Row[] }>(
        app,
        'GET',
        '/api/venues',
        {
          user: organizerA,
        },
      );
      expect(list.body.data.map((v) => v.id).sort()).toEqual(
        [shared.id, own.id].sort(),
      );

      const editShared = await apiRequest(
        app,
        'PATCH',
        `/api/venues/${shared.id}`,
        { user: organizerA, body: { name: 'X' } },
      );
      expect(editShared.status).toBe(403);
      const editOwn = await apiRequest(app, 'PATCH', `/api/venues/${own.id}`, {
        user: organizerA,
        body: { name: 'Своя 2', city: 'казань' },
      });
      expect(editOwn.status).toBe(200);
      expect((editOwn.body as { data: { city: string } }).data.city).toBe(
        'Казань',
      );

      const tableOnShared = await apiRequest(app, 'POST', '/api/tables', {
        user: organizerA,
        body: { name: 'Стол 1', venueId: shared.id },
      });
      expect(tableOnShared.status).toBe(403);
      const tableOnOwn = await apiRequest(app, 'POST', '/api/tables', {
        user: organizerA,
        body: { name: 'Стол 1', venueId: own.id },
      });
      expect(tableOnOwn.status).toBe(201);
      const [foreignTable] = await db
        .insert(tables)
        .values({ name: 'Чужой стол', venueId: shared.id })
        .returning();
      const tablesList = await apiRequest<{ data: Row[] }>(
        app,
        'GET',
        '/api/tables',
        { user: organizerA },
      );
      // столы общей площадки видны, чужой федерации — нет
      expect(tablesList.body.data.map((t) => t.id)).toContain(
        must(foreignTable).id,
      );
    });

    it('venue creation requires a city and, for organizers, their own federation', async () => {
      const noCity = await apiRequest(app, 'POST', '/api/venues', {
        user: admin,
        body: { name: 'Клуб', address: 'ул. 1' },
      });
      expect(noCity.status).toBe(400);
      const foreign = await apiRequest(app, 'POST', '/api/venues', {
        user: organizerA,
        body: {
          name: 'Клуб',
          address: 'ул. 1',
          city: 'Москва',
          federationId: fedB.id,
        },
      });
      expect(foreign.status).toBe(403);
      const ok = await apiRequest<{ data: { federationId: UUID } }>(
        app,
        'POST',
        '/api/venues',
        {
          user: organizerA,
          body: {
            name: 'Клуб',
            address: 'ул. 1',
            city: 'Москва',
            federationId: fedA.id,
          },
        },
      );
      expect(ok.status).toBe(201);
      expect(ok.body.data.federationId).toBe(fedA.id);
    });
  });

  describe('users roster', () => {
    it('organizer sees roster (participants, team, own guests) without contacts; @username finds outsiders', async () => {
      const t = await createTournament({ federationId: fedA.id });
      const { userId: player } = await createConfirmedParticipant(t.id);
      const guest = await createUser({ createdByFederationId: fedA.id });
      const outsider = await createUser({
        telegram_id: '555',
        username: 'outsider',
        email: 'o@example.com',
      });
      const foreignT = await createTournament({ federationId: fedB.id });
      const { userId: foreignPlayer } = await createConfirmedParticipant(
        foreignT.id,
      );

      const list = await apiRequest<{ data: Row[] }>(app, 'GET', '/api/users', {
        user: organizerA,
      });
      const ids = list.body.data.map((u) => u.id);
      expect(ids).toEqual(
        expect.arrayContaining([player, guest.id, organizerA.id, fedA.ownerId]),
      );
      expect(ids).not.toContain(outsider.id);
      expect(ids).not.toContain(foreignPlayer);
      expect(list.body.data[0]).not.toHaveProperty('email');
      expect(list.body.data[0]).not.toHaveProperty('telegram_id');
      expect(list.body.data[0]).toHaveProperty('telegramLinked');

      const search = await apiRequest<{ data: Row[] }>(
        app,
        'GET',
        '/api/users?q=%40outsider',
        { user: organizerA },
      );
      expect(search.body.data.map((u) => u.id)).toContain(outsider.id);

      const detail = await apiRequest(
        app,
        'GET',
        `/api/users/${foreignPlayer}`,
        {
          user: organizerA,
        },
      );
      expect(detail.status).toBe(404);

      // Гостя своей федерации организатор правит, чужого игрока — нет.
      const editGuest = await apiRequest(
        app,
        'PATCH',
        `/api/users/${guest.id}`,
        {
          user: organizerA,
          body: { name: 'Новое имя' },
        },
      );
      expect(editGuest.status).toBe(200);
      const editPlayer = await apiRequest(
        app,
        'PATCH',
        `/api/users/${player}`,
        {
          user: organizerA,
          body: { name: 'Новое имя' },
        },
      );
      expect(editPlayer.status).toBe(403);

      // Админ по-прежнему видит всех с контактами.
      const adminList = await apiRequest<{ data: Row[] }>(
        app,
        'GET',
        '/api/users',
        { user: admin },
      );
      expect(adminList.body.data.map((u) => u.id)).toContain(outsider.id);
      expect(adminList.body.data[0]).toHaveProperty('email');
    });
  });

  describe('federations CRUD', () => {
    it('admin lists all with counts; organizer lists own with role', async () => {
      await createTournament({ federationId: fedA.id });
      const adminList = await apiRequest<{
        data: { id: UUID; membersCount: number; tournamentsCount: number }[];
      }>(app, 'GET', '/api/federations', { user: admin });
      expect(adminList.body.data).toHaveLength(2);
      const a = adminList.body.data.find((f) => f.id === fedA.id);
      expect(a).toMatchObject({ membersCount: 2, tournamentsCount: 1 });

      const mine = await apiRequest<{ data: { id: UUID; role: string }[] }>(
        app,
        'GET',
        '/api/federations',
        { user: organizerA },
      );
      expect(mine.body.data).toMatchObject([
        {
          id: fedA.id,
          name: 'Лига А',
          city: 'Москва',
          role: 'organizer',
        },
      ]);
    });

    it('admin creates a federation for another owner by @username; organizer only for self', async () => {
      const owner = await createUser({ telegram_id: '101', username: 'boss' });
      const created = await apiRequest<{ data: { id: UUID } }>(
        app,
        'POST',
        '/api/federations',
        {
          user: admin,
          body: { name: 'Новая', city: 'тверь', ownerUsername: '@boss' },
        },
      );
      expect(created.status).toBe(201);
      const members = await apiRequest<{
        data: { userId: UUID; role: string }[];
      }>(app, 'GET', `/api/federations/${created.body.data.id}/members`, {
        user: admin,
      });
      expect(members.body.data).toEqual([
        expect.objectContaining({ userId: owner.id, role: 'owner' }),
      ]);

      const forbidden = await apiRequest(app, 'POST', '/api/federations', {
        user: organizerA,
        body: { name: 'Чужая', city: 'Тверь', ownerUsername: '@boss' },
      });
      expect(forbidden.status).toBe(403);

      // своя организация — только при действующем праве организатора
      const unpaid = await apiRequest<{ error: string }>(
        app,
        'POST',
        '/api/federations',
        { user: organizerA, body: { name: 'Моя', city: 'Тверь' } },
      );
      expect(unpaid.status).toBe(400);
      expect(unpaid.body.error).toMatch(/платная опция/);

      await setOrganizerUntil(organizerA.id, grantUntil());
      const selfMade = await apiRequest<{ data: { id: UUID } }>(
        app,
        'POST',
        '/api/federations',
        { user: organizerA, body: { name: 'Моя', city: 'Тверь' } },
      );
      expect(selfMade.status).toBe(201);
      const me = await apiRequest<{
        federations: { id: UUID; role: string }[];
      }>(app, 'GET', '/api/auth/me', { user: organizerA });
      expect(me.body.federations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: selfMade.body.data.id, role: 'owner' }),
        ]),
      );
    });

    it('members: owner manages, organizer cannot; last-owner guard → 409; organizer can leave', async () => {
      const newbie = await createUser({
        telegram_id: '202',
        username: 'newbie',
      });
      const ownerUser = await createUser();
      // fedA.ownerId — владелец; делаем из него актора
      const owner = { ...ownerUser, id: fedA.ownerId, role: 'user' as const };

      const byOrganizer = await apiRequest(
        app,
        'POST',
        `/api/federations/${fedA.id}/members`,
        { user: organizerA, body: { username: 'newbie' } },
      );
      expect(byOrganizer.status).toBe(403);

      const byOwner = await apiRequest<{ data: { userId: UUID }[] }>(
        app,
        'POST',
        `/api/federations/${fedA.id}/members`,
        { user: owner, body: { username: '@newbie', role: 'organizer' } },
      );
      expect(byOwner.status).toBe(201);
      expect(byOwner.body.data.map((m) => m.userId)).toContain(newbie.id);
      expect(sendMessageSpy).toHaveBeenCalled();

      const dup = await apiRequest(
        app,
        'POST',
        `/api/federations/${fedA.id}/members`,
        { user: owner, body: { username: 'newbie' } },
      );
      expect(dup.status).toBe(409);

      const demoteLast = await apiRequest(
        app,
        'PATCH',
        `/api/federations/${fedA.id}/members/${fedA.ownerId}`,
        { user: admin, body: { role: 'organizer' } },
      );
      expect(demoteLast.status).toBe(409);

      const kickSelfAsOrganizer = await apiRequest(
        app,
        'DELETE',
        `/api/federations/${fedA.id}/members/${organizerA.id}`,
        { user: organizerA },
      );
      expect(kickSelfAsOrganizer.status).toBe(200);
      const after = await apiRequest(app, 'GET', '/api/tournaments', {
        user: organizerA,
      });
      expect(after.status).toBe(403); // больше не staff

      const foreignRead = await apiRequest(
        app,
        'GET',
        `/api/federations/${fedB.id}`,
        { user: owner },
      );
      expect(foreignRead.status).toBe(404);
    });

    it('delete: admin only, 409 while referenced', async () => {
      await createTournament({ federationId: fedA.id });
      const byOrganizer = await apiRequest(
        app,
        'DELETE',
        `/api/federations/${fedA.id}`,
        { user: organizerA },
      );
      expect(byOrganizer.status).toBe(403);
      const referenced = await apiRequest(
        app,
        'DELETE',
        `/api/federations/${fedA.id}`,
        { user: admin },
      );
      expect(referenced.status).toBe(409);
      const ok = await apiRequest(
        app,
        'DELETE',
        `/api/federations/${fedB.id}`,
        {
          user: admin,
        },
      );
      expect(ok.status).toBe(200);
    });
  });

  describe('group chats binding', () => {
    it('owner binds/unbinds own or free chats; organizer cannot; foreign binding → 409', async () => {
      const owner = {
        ...(await createUser()),
        id: fedA.ownerId,
        role: 'user' as const,
      };
      await registerGroupChat({
        chatId: '-500',
        type: 'group',
        title: 'Наш чат',
        addedBy: organizerA.id,
      });
      await registerGroupChat({
        chatId: '-501',
        type: 'group',
        title: 'Чужой',
        addedBy: null,
      });
      await bindGroupChat('-501', fedB.id);

      const list = await apiRequest<{
        data: { chatId: string; bound: boolean }[];
      }>(app, 'GET', `/api/federations/${fedA.id}/chats`, { user: organizerA });
      expect(list.body.data).toEqual([
        expect.objectContaining({ chatId: '-500', bound: false }),
      ]);

      const byOrganizer = await apiRequest(
        app,
        'POST',
        `/api/federations/${fedA.id}/chats/-500/bind`,
        { user: organizerA },
      );
      expect(byOrganizer.status).toBe(403);

      const bind = await apiRequest(
        app,
        'POST',
        `/api/federations/${fedA.id}/chats/-500/bind`,
        { user: owner },
      );
      expect(bind.status).toBe(200);
      expect((await getGroupChat('-500'))?.federationId).toBe(fedA.id);

      const foreign = await apiRequest(
        app,
        'POST',
        `/api/federations/${fedA.id}/chats/-501/bind`,
        { user: owner },
      );
      expect(foreign.status).toBe(409);

      const unbind = await apiRequest(
        app,
        'DELETE',
        `/api/federations/${fedA.id}/chats/-500/bind`,
        { user: owner },
      );
      expect(unbind.status).toBe(200);
      expect((await getGroupChat('-500'))?.federationId).toBeNull();
    });
  });

  describe('leaderboard', () => {
    it('organizer filter by foreign federation is refused (403)', async () => {
      const res = await apiRequest(
        app,
        'GET',
        `/api/leaderboard/breaks?federationId=${fedB.id}`,
        { user: organizerA },
      );
      expect(res.status).toBe(403);
      const own = await apiRequest(app, 'GET', '/api/leaderboard/breaks', {
        user: organizerA,
      });
      expect(own.status).toBe(200);
    });
  });
});
