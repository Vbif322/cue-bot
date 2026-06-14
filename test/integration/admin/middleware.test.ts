import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { users } from '@/db/schema.js';
import { createAdminServer } from '@/admin/server/index.js';

import { adminCookie, apiRequest, expiredCookie } from '../../helpers/auth.js';
import { createAdminUser, createUser } from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

const app = createAdminServer();

// `/api/users` is an arbitrary protected endpoint used to exercise requireAdmin.
const PROTECTED = '/api/users';

describe('requireAdmin middleware', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('rejects requests without a cookie (401)', async () => {
    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'GET',
      PROTECTED,
    );
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects a malformed token (401 Invalid token)', async () => {
    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'GET',
      PROTECTED,
      { cookie: 'admin_token=garbage' },
    );
    expect(status).toBe(401);
    expect(body).toEqual({ error: 'Invalid token' });
  });

  it('rejects an expired token (401)', async () => {
    const admin = await createAdminUser();
    const { status } = await apiRequest(app, 'GET', PROTECTED, {
      cookie: expiredCookie(admin),
    });
    expect(status).toBe(401);
  });

  it('rejects a valid token whose user is no longer an admin (403)', async () => {
    // DB re-check on every request: token claims admin, but the row is a user.
    const user = await createUser();
    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'GET',
      PROTECTED,
      { cookie: adminCookie({ ...user, role: 'admin' }) },
    );
    expect(status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('rejects a valid token whose user was deleted (403)', async () => {
    const admin = await createAdminUser();
    const cookie = adminCookie(admin);
    await db.delete(users).where(eq(users.id, admin.id));

    const { status, body } = await apiRequest<{ error: string }>(
      app,
      'GET',
      PROTECTED,
      { cookie },
    );
    expect(status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });

  it('admits a valid admin token (200)', async () => {
    const admin = await createAdminUser();
    const { status } = await apiRequest(app, 'GET', PROTECTED, { user: admin });
    expect(status).toBe(200);
  });
});
