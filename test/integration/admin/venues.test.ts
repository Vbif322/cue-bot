import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';

import { apiRequest } from '../../helpers/auth.js';
import { createAdminUser, createVenue } from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

const app = createAdminServer();

interface VenueRow {
  id: UUID;
  name: string;
  address: string;
  image: string | null;
}

describe('admin venues router', () => {
  let admin: Awaited<ReturnType<typeof createAdminUser>>;

  beforeEach(async () => {
    await truncateAll();
    admin = await createAdminUser();
  });

  it('requires authentication (401)', async () => {
    const { status } = await apiRequest(app, 'GET', '/api/venues');
    expect(status).toBe(401);
  });

  it('creates, lists, updates and deletes a venue', async () => {
    const created = await apiRequest<{ data: VenueRow }>(
      app,
      'POST',
      '/api/venues',
      { user: admin, body: { name: 'Клуб', address: 'ул. Пушкина 1' } },
    );
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('Клуб');
    const id = created.body.data.id;

    const list = await apiRequest<{ data: VenueRow[] }>(
      app,
      'GET',
      '/api/venues',
      { user: admin },
    );
    expect(list.body.data.map((v) => v.id)).toContain(id);

    const updated = await apiRequest<{ data: VenueRow }>(
      app,
      'PATCH',
      `/api/venues/${id}`,
      { user: admin, body: { name: 'Клуб 2' } },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Клуб 2');

    const deleted = await apiRequest<{ ok: boolean }>(
      app,
      'DELETE',
      `/api/venues/${id}`,
      { user: admin },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
  });

  it('rejects creation without an address (400)', async () => {
    const { status } = await apiRequest(app, 'POST', '/api/venues', {
      user: admin,
      body: { name: 'Клуб' },
    });
    expect(status).toBe(400);
  });

  it('rejects an empty PATCH body (400)', async () => {
    const venue = await createVenue();
    const { status } = await apiRequest(
      app,
      'PATCH',
      `/api/venues/${venue.id}`,
      { user: admin, body: {} },
    );
    expect(status).toBe(400);
  });

  it('returns 404 when updating an unknown venue', async () => {
    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'PATCH',
      '/api/venues/00000000-0000-0000-0000-000000000000',
      { user: admin, body: { name: 'X' } },
    );
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });

  it('returns 404 when deleting an unknown venue', async () => {
    const { status } = await apiRequest(
      app,
      'DELETE',
      '/api/venues/00000000-0000-0000-0000-000000000000',
      { user: admin },
    );
    expect(status).toBe(404);
  });
});
