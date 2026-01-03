import type { NextFunction } from "grammy";
import { eq } from "drizzle-orm";
import { db } from "../../db/db.js";
import { users } from "../../db/schema.js";
import type { BotContext } from "../types.js";

export async function authMiddleware(
  ctx: BotContext,
  next: NextFunction
): Promise<void> {
  const telegramUser = ctx.from;

  if (!telegramUser) {
    return next();
  }

  const telegramId = telegramUser.id.toString();

  let dbUser = await db.query.users.findFirst({
    where: eq(users.telegram_id, telegramId),
  });

  if (!dbUser) {
    const [newUser] = await db
      .insert(users)
      .values({
        telegram_id: telegramId,
        username: telegramUser.username ?? `user_${telegramId}`,
        name: telegramUser.first_name,
        surname: telegramUser.last_name ?? undefined,
      })
      .returning();

    dbUser = newUser;
  }

  if (!dbUser) {
    throw new Error("Failed to get or create user");
  }

  ctx.dbUser = dbUser;
  return next();
}
