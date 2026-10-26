import type { NextFunction } from 'grammy';

import { canOrganize, isAdmin } from './permissions.js';
import type { BotContext } from './types.js';

/** Только платформенный админ (`/set_admin`, `/remove_admin`). */
export function adminOnly(
  errorMessage = 'Эта команда доступна только администраторам.',
) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    if (!isAdmin(ctx)) {
      await ctx.reply(errorMessage);
      return;
    }
    return next();
  };
}

/**
 * Админ или организатор (член хотя бы одной федерации). Гейт на ВХОД в команду;
 * право на конкретный турнир проверяется отдельно (`canAdministerTournament`).
 */
export function organizerOnly(
  errorMessage = 'Эта команда доступна организаторам и администраторам.',
) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    if (!(await canOrganize(ctx))) {
      await ctx.reply(errorMessage);
      return;
    }
    return next();
  };
}

export function privateOnly(
  errorMessage = 'Эта команда доступна только в личных сообщениях.',
) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply(errorMessage);
      return;
    }
    return next();
  };
}
