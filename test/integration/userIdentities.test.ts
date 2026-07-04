import type { UUID } from 'crypto';

import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/db.js';
import { authMiddleware } from '@/bot/middleware/auth.js';
import { anonymizeUser } from '@/services/userService.js';
import type { BotContext } from '@/bot/types.js';

import { createUser } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

/**
 * Fake a minimal `BotContext` carrying a Telegram user, the way authMiddleware
 * reads it (`ctx.from`), plus a settable `ctx.dbUser`. Mirrors the makeCtx
 * pattern in test/unit/bot/middleware/rateLimit.test.ts.
 */
function makeCtx(from: {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}) {
  const ctx = { from } as unknown as BotContext;
  const next = vi.fn().mockResolvedValue(undefined);
  return { ctx, next };
}

/** All identity rows for a user, ordered for stable assertions. */
async function identitiesOf(userId: UUID) {
  return db.query.userIdentities.findMany({
    where: (i, { eq }) => eq(i.userId, userId),
  });
}

/** The idempotent telegram backfill from migration 0014, re-runnable in-test. */
async function runBackfill() {
  await db.execute(sql`
    INSERT INTO "prod"."user_identities" (user_id, provider, provider_id)
    SELECT id, 'telegram', telegram_id FROM "prod"."users"
    WHERE telegram_id IS NOT NULL AND deleted_at IS NULL
    ON CONFLICT (provider, provider_id) DO NOTHING;
  `);
}

describe('authMiddleware — telegram identity', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('creates a users row and a telegram identity on first login', async () => {
    const { ctx, next } = makeCtx({
      id: 987654,
      username: 'newplayer',
      first_name: 'Иван',
    });

    await authMiddleware(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(ctx.dbUser).toBeDefined();
    expect(ctx.dbUser.telegram_id).toBe('987654');

    const identities = await identitiesOf(ctx.dbUser.id);
    expect(identities).toHaveLength(1);
    expect(identities[0]?.provider).toBe('telegram');
    expect(identities[0]?.providerId).toBe('987654');
    expect(identities[0]?.emailVerifiedAt).toBeNull();
  });

  it('does not duplicate the identity on repeated logins', async () => {
    const first = makeCtx({ id: 555, username: 'repeat', first_name: 'A' });
    await authMiddleware(first.ctx, first.next);
    const userId = first.ctx.dbUser.id;

    const second = makeCtx({ id: 555, username: 'repeat', first_name: 'A' });
    await authMiddleware(second.ctx, second.next);

    expect(second.ctx.dbUser.id).toBe(userId);
    expect(await identitiesOf(userId)).toHaveLength(1);
  });
});

describe('telegram identity backfill (migration 0014)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('is idempotent and skips deleted users', async () => {
    const active = await createUser({ telegram_id: '111' });
    await createUser({ telegram_id: '222' });
    // Anonymized/deleted user: excluded by the WHERE clause.
    await createUser({ telegram_id: '333', deletedAt: new Date() });
    // User without a telegram_id: nothing to backfill.
    await createUser({ telegram_id: null });

    await runBackfill();
    await runBackfill(); // second run must not add duplicates

    const all = await db.query.userIdentities.findMany();
    expect(all).toHaveLength(2);
    expect(all.map((i) => i.providerId).sort()).toEqual(['111', '222']);
    expect(all.every((i) => i.provider === 'telegram')).toBe(true);

    const activeIdentities = await identitiesOf(active.id);
    expect(activeIdentities).toHaveLength(1);
    expect(activeIdentities[0]?.userId).toBe(active.id);
  });
});

describe('anonymizeUser — identity cascade', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('removes the identity while keeping the soft-deleted users row', async () => {
    const { ctx, next } = makeCtx({ id: 42, username: 'gone', first_name: 'X' });
    await authMiddleware(ctx, next);
    const userId = ctx.dbUser.id;
    expect(await identitiesOf(userId)).toHaveLength(1);

    await anonymizeUser(userId);

    expect(await identitiesOf(userId)).toHaveLength(0);

    const user = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, userId),
    });
    expect(user).toBeDefined();
    expect(user?.deletedAt).not.toBeNull();
    expect(user?.telegram_id).toBeNull();
  });
});
