import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';

import { apiRequest } from '../../helpers/auth.js';
import { createAdminUser, createVenue } from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

const app = createAdminServer();

interface TableRow {
  id: UUID;
  name: string;
  venueId: UUID;
}

describe('admin tables router', () => {
  let admin: Awaited<ReturnType<typeof createAdminUser>>;

  beforeEach(async () => {
    await truncateAll();
    admin = await createAdminUser();
  });

  it('requires authentication (401)', async () => {
    const { status } = await apiRequest(app, 'GET', '/api/tables');
    expect(status).toBe(401);
  });

  it('creates, lists and deletes a table', async () => {
    const venue = await createVenue();

    const created = await apiRequest<{ data: TableRow }>(
      app,
      'POST',
      '/api/tables',
      { user: admin, body: { name: 'Стол 1', venueId: venue.id } },
    );
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('Стол 1');
    const tableId = created.body.data.id;

    const list = await apiRequest<{ data: TableRow[] }>(
      app,
      'GET',
      '/api/tables',
      { user: admin },
    );
    expect(list.body.data.map((t) => t.id)).toContain(tableId);

    const deleted = await apiRequest<{ ok: boolean }>(
      app,
      'DELETE',
      `/api/tables/${tableId}`,
      { user: admin },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
  });

  it('rejects creation with a missing name (400)', async () => {
    const venue = await createVenue();
    const { status } = await apiRequest(app, 'POST', '/api/tables', {
      user: admin,
      body: { venueId: venue.id },
    });
    expect(status).toBe(400);
  });

  it('rejects a non-uuid venueId (400)', async () => {
    const { status } = await apiRequest(app, 'POST', '/api/tables', {
      user: admin,
      body: { name: 'Стол', venueId: 'nope' },
    });
    expect(status).toBe(400);
  });

  it('returns 404 when deleting an unknown table', async () => {
    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'DELETE',
      '/api/tables/00000000-0000-0000-0000-000000000000',
      { user: admin },
    );
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Not found' });
  });
});
