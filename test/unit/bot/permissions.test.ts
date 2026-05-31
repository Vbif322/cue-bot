import { describe, expect, it } from 'vitest';

import { isAdmin } from '@/bot/permissions.js';

const ctxWithRole = (role: 'admin' | 'user') =>
  ({ dbUser: { role } }) as unknown as Parameters<typeof isAdmin>[0];

describe('isAdmin', () => {
  it('is true for an admin user', () => {
    expect(isAdmin(ctxWithRole('admin'))).toBe(true);
  });

  it('is false for a regular user', () => {
    expect(isAdmin(ctxWithRole('user'))).toBe(false);
  });
});
