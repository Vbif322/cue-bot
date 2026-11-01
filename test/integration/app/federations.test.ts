import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';
import { setOrganizerUntil } from '@/services/federationService.js';

import { apiRequest, appCookie } from '../../helpers/auth.js';
import {
  createFederation,
  createTournament,
  createUser,
  createVenue,
  grantUntil,
} from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

let app: ReturnType<typeof createAdminServer>;

describe('app: federations, feed filters, city, unlisted', () => {
  beforeEach(async () => {
    app = createAdminServer();
    await truncateAll();
  });

  it('GET /api/app/tournaments filters by city (case-insensitive) and by organizer', async () => {
    const fed = await createFederation({ name: 'Лига', city: 'Казань' });
    const other = await createFederation({ name: 'Клуб', city: 'Москва' });
    const kazan = await createVenue({ city: 'Казань' });
    const moscow = await createVenue({ city: 'Москва' });
    const a = await createTournament({
      status: 'registration_open',
      venueId: kazan.id,
      federationId: fed.id,
    });
    const b = await createTournament({
      status: 'registration_open',
      venueId: moscow.id,
      federationId: other.id,
    });
    await createTournament({ status: 'registration_open', venueId: moscow.id });

    const byCity = await apiRequest<{
      data: { id: UUID; venueCity: string; federationName: string }[];
    }>(
      app,
      'GET',
      '/api/app/tournaments?city=%D0%BA%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C',
    );
    expect(byCity.status).toBe(200);
    expect(byCity.body.data.map((t) => t.id)).toEqual([a.id]);
    expect(byCity.body.data[0]).toMatchObject({
      venueCity: 'Казань',
      federationName: 'Лига',
    });

    const byFed = await apiRequest<{ data: { id: UUID }[] }>(
      app,
      'GET',
      `/api/app/tournaments?federationId=${other.id}`,
    );
    expect(byFed.body.data.map((t) => t.id)).toEqual([b.id]);

    const all = await apiRequest<{ data: { id: UUID }[] }>(
      app,
      'GET',
      '/api/app/tournaments',
    );
    expect(all.body.data).toHaveLength(3);

    const bad = await apiRequest(
      app,
      'GET',
      '/api/app/tournaments?federationId=nope',
    );
    expect(bad.status).toBe(400);
  });

  it('unlisted: hidden from the feed, but the card opens for a guest and registration works without an invite', async () => {
    const t = await createTournament({
      status: 'registration_open',
      visibility: 'unlisted',
    });
    const feed = await apiRequest<{ data: { id: UUID }[] }>(
      app,
      'GET',
      '/api/app/tournaments',
    );
    expect(feed.body.data.map((x) => x.id)).not.toContain(t.id);

    const card = await apiRequest(app, 'GET', `/api/app/tournaments/${t.id}`);
    expect(card.status).toBe(200);

    const player = await createUser();
    const reg = await apiRequest(
      app,
      'POST',
      `/api/app/tournaments/${t.id}/register`,
      {
        cookie: appCookie(player.id),
      },
    );
    expect(reg.status).toBe(200);
  });

  it('private tournament is visible to an organizer of its federation on the player site', async () => {
    const fed = await createFederation();
    const t = await createTournament({
      visibility: 'private',
      status: 'registration_open',
      federationId: fed.id,
    });
    const stranger = await createUser();
    const hidden = await apiRequest(
      app,
      'GET',
      `/api/app/tournaments/${t.id}`,
      {
        cookie: appCookie(stranger.id),
      },
    );
    expect(hidden.status).toBe(404);
    const seen = await apiRequest(app, 'GET', `/api/app/tournaments/${t.id}`, {
      cookie: appCookie(fed.ownerId),
    });
    expect(seen.status).toBe(200);
  });

  it('GET /api/app/federations lists organizers (optionally by city); GET /:id is public', async () => {
    const fed = await createFederation({ name: 'Лига', city: 'Казань' });
    await createFederation({ name: 'Клуб', city: 'Москва' });

    const all = await apiRequest<{ data: { id: UUID; name: string }[] }>(
      app,
      'GET',
      '/api/app/federations',
    );
    expect(all.body.data.map((f) => f.name).sort()).toEqual(['Клуб', 'Лига']);

    const kazan = await apiRequest<{ data: { id: UUID }[] }>(
      app,
      'GET',
      '/api/app/federations?city=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C',
    );
    expect(kazan.body.data.map((f) => f.id)).toEqual([fed.id]);

    const one = await apiRequest<{ data: { id: UUID; name: string } }>(
      app,
      'GET',
      `/api/app/federations/${fed.id}`,
    );
    expect(one.status).toBe(200);
    expect(one.body.data).toEqual({
      id: fed.id,
      name: 'Лига',
      city: 'Казань',
      description: null,
    });
  });

  it('no self-service creation on the player site; an organizer grant flips isStaff', async () => {
    const user = await createUser();
    const removed = await app.request('/api/app/federations', {
      method: 'POST',
      headers: {
        Cookie: appCookie(user.id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Моя лига', city: 'тверь' }),
    });
    expect(removed.status).toBe(404);

    const before = await apiRequest<{ data: { user: { isStaff: boolean } } }>(
      app,
      'GET',
      '/api/app/auth/me',
      { cookie: appCookie(user.id) },
    );
    expect(before.body.data.user.isStaff).toBe(false);

    await setOrganizerUntil(user.id, grantUntil());
    const after = await apiRequest<{
      data: { user: { isStaff: boolean; isAdmin: boolean } };
    }>(app, 'GET', '/api/app/auth/me', { cookie: appCookie(user.id) });
    expect(after.body.data.user).toMatchObject({
      isStaff: true,
      isAdmin: false,
    });
  });

  it('PATCH /api/app/me stores a normalised city', async () => {
    const user = await createUser();
    const res = await apiRequest<{ data: { city: string | null } }>(
      app,
      'PATCH',
      '/api/app/me',
      { cookie: appCookie(user.id), body: { city: '  нижний   новгород ' } },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.city).toBe('Нижний Новгород');

    const cleared = await apiRequest<{ data: { city: string | null } }>(
      app,
      'PATCH',
      '/api/app/me',
      { cookie: appCookie(user.id), body: { city: null } },
    );
    expect(cleared.body.data.city).toBeNull();
  });
});
