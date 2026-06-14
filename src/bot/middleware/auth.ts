import type { NextFunction } from 'grammy';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { users } from '@/db/schema.js';

import type { BotContext } from '../types.js';

export async function authMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const telegramUser = ctx.from;

  if (!telegramUser) {
    return next();
  }

  const telegramId = telegramUser.id.toString();
  // Keep username in sync with Telegram so it stays a deterministic identifier
  // for bot role commands (S2-2). Telegram usernames are reusable, so before
  // claiming `desired` we release it from any stale row (the partial unique
  // index on username for telegram accounts would otherwise reject the write).
  const desired = telegramUser.username ?? `user_${telegramId}`;

  const dbUser = await db.transaction(async (tx) => {
    let existing = await tx.query.users.findFirst({
      where: eq(users.telegram_id, telegramId),
    });

    const needsClaim = existing?.username !== desired;
    if (needsClaim) {
      await tx
        .update(users)
        .set({ username: sql`'user_' || ${users.telegram_id}` })
        .where(
          and(
            eq(users.username, desired),
            isNotNull(users.telegram_id),
            existing ? ne(users.id, existing.id) : sql`true`,
          ),
        );
    }

    if (!existing) {
      [existing] = await tx
        .insert(users)
        .values({
          telegram_id: telegramId,
          username: desired,
          name: telegramUser.first_name,
          surname: telegramUser.last_name ?? undefined,
        })
        .returning();
    } else if (existing.username !== desired) {
      await tx
        .update(users)
        .set({ username: desired })
        .where(eq(users.id, existing.id));
      existing.username = desired;
    }

    return existing;
  });

  if (!dbUser) {
    throw new Error('Failed to get or create user');
  }

  ctx.dbUser = dbUser;
  return next();
}
