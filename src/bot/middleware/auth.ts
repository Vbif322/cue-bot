import type { NextFunction } from 'grammy';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities, users } from '@/db/schema.js';

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
      // Upsert on telegram_id: if a concurrent first-login transaction already
      // inserted this user between our findFirst and here, resolve to an update
      // instead of failing on the telegram_id unique constraint. Hardening for a
      // future move to @grammyjs/runner / webhooks / multi-process (updates are
      // processed sequentially today, so the race is currently only theoretical).
      [existing] = await tx
        .insert(users)
        .values({
          telegram_id: telegramId,
          username: desired,
          name: telegramUser.first_name,
          surname: telegramUser.last_name ?? undefined,
        })
        .onConflictDoUpdate({
          target: users.telegram_id,
          set: { username: desired },
        })
        .returning();

      if (!existing) {
        throw new Error('Failed to create user');
      }

      // Реестр способов входа (S2-2). Аддитивно: бот по-прежнему идентифицирует
      // юзера по users.telegram_id, но новая identity-строка готовит почву под
      // web-логин (Этап 3). Существующим юзерам identity создаёт бэкфилл миграции;
      // здесь покрываем только новосозданных. onConflictDoNothing защищает от гонки
      // первого входа (два конкурентных tx резолвятся в один users.id).
      await tx
        .insert(userIdentities)
        .values({
          userId: existing.id,
          provider: 'telegram',
          providerId: telegramId,
        })
        .onConflictDoNothing({
          target: [userIdentities.provider, userIdentities.providerId],
        });
    } else if (existing.username !== desired) {
      await tx
        .update(users)
        .set({ username: desired })
        .where(eq(users.id, existing.id));
      existing.username = desired;
    }

    return existing;
  });

  ctx.dbUser = dbUser;
  return next();
}
