import type { NextFunction } from 'grammy';

import { getOrCreateTelegramUser } from '@/services/userService.js';

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
  // Держим username в синхроне с Telegram — он служит детерминированным
  // идентификатором для ролевых команд бота (S2-2). Фолбэк на `user_<id>`, если
  // у аккаунта нет username. Создание users + telegram-identity вынесено в общий
  // хелпер, разделяемый с web-входом через Telegram Login Widget (Этап 7).
  const desired = telegramUser.username ?? `user_${telegramId}`;

  ctx.dbUser = await getOrCreateTelegramUser(telegramId, {
    username: desired,
    name: telegramUser.first_name,
    surname: telegramUser.last_name ?? undefined,
  });

  return next();
}
