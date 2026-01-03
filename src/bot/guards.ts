import type { NextFunction } from "grammy";
import type { BotContext } from "./types.js";
import { isAdmin } from "./permissions.js";

export function adminOnly(
  errorMessage = "Эта команда доступна только администраторам."
) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    if (!isAdmin(ctx)) {
      await ctx.reply(errorMessage);
      return;
    }
    return next();
  };
}

export function privateOnly(
  errorMessage = "Эта команда доступна только в личных сообщениях."
) {
  return async (ctx: BotContext, next: NextFunction): Promise<void> => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply(errorMessage);
      return;
    }
    return next();
  };
}
