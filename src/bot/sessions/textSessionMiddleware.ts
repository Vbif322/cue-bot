import { Composer, type NextFunction } from 'grammy';

import type { BotContext } from '../types.js';
import {
  endTextSession,
  getActiveTextSession,
  type ActiveTextSession,
  type TextMessageContext,
  type TextSessionEndReason,
} from './textSessionRegistry.js';
import {
  NOTHING_TO_CANCEL_TEXT,
  blockedCallbackText,
  blockedMessageText,
  classifyMessage,
  decideGuard,
  guardNeedsSession,
  type GuardInput,
} from './textSessionRouting.js';

export interface TextSessionDeps {
  lookup: (userId: number) => Promise<ActiveTextSession | undefined>;
  end: (
    ctx: BotContext,
    userId: number,
    active: ActiveTextSession,
    reason: TextSessionEndReason,
  ) => Promise<boolean>;
}

const defaultDeps: TextSessionDeps = {
  lookup: getActiveTextSession,
  end: endTextSession,
};

function guardInputOf(ctx: BotContext): GuardInput {
  const data = ctx.callbackQuery?.data;
  if (data !== undefined) return { kind: 'callback', data };
  const text = ctx.message?.text;
  if (text !== undefined)
    return { kind: 'message', cls: classifyMessage(text) };
  return { kind: 'other' };
}

/**
 * Guard: блокирует посторонние действия во время blocking-сессии (wizard'а) и
 * завершает мягкую сессию, когда пользователь ушёл в команду или меню.
 */
export async function sessionGuard(
  ctx: BotContext,
  next: NextFunction,
  deps: TextSessionDeps = defaultDeps,
): Promise<void> {
  // Страховка: групповые апдейты отсекает chatScopeMiddleware выше по цепочке,
  // но guard не должен отвечать «Завершите…» в групповой чат.
  if (ctx.chat?.type !== 'private') return next();
  const userId = ctx.from?.id;
  if (userId === undefined) return next();

  const input = guardInputOf(ctx);
  if (!guardNeedsSession(input)) return next();

  const active = await deps.lookup(userId);
  switch (decideGuard(active?.session, input)) {
    case 'pass':
      return next();
    case 'block-callback':
      await ctx.answerCallbackQuery({
        text: blockedCallbackText(active?.session.name ?? ''),
      });
      return;
    case 'block-message':
      await ctx.reply(blockedMessageText(active?.session.name ?? ''));
      return;
    case 'end-then-pass':
      if (active) await deps.end(ctx, userId, active, 'superseded');
      return next();
  }
}

/** Единственный /cancel: завершает активную сессию любого флоу. */
export async function handleCancel(
  ctx: BotContext,
  deps: TextSessionDeps = defaultDeps,
): Promise<void> {
  const userId = ctx.from?.id;
  if (userId === undefined) return;

  const active = await deps.lookup(userId);
  if (!active || !(await deps.end(ctx, userId, active, 'cancel'))) {
    await ctx.reply(NOTHING_TO_CANCEL_TEXT);
    return;
  }
  await ctx.reply(active.session.cancelReply);
}

/** Единственный текстовый хендлер: отдаёт текст активной сессии. */
export async function dispatchText(
  ctx: TextMessageContext,
  next: NextFunction,
  deps: TextSessionDeps = defaultDeps,
): Promise<void> {
  if (ctx.chat.type !== 'private') return next();
  if (classifyMessage(ctx.message.text) !== 'text') return next();

  const active = await deps.lookup(ctx.from.id);
  if (!active) return next();
  await active.session.handleText(ctx, active.data);
}

/** Регистрируется сразу после guard'а — до любых других обработчиков /cancel. */
export const sessionCancelCommand = new Composer<BotContext>();
sessionCancelCommand.command('cancel', (ctx) => handleCancel(ctx));

/** Регистрируется ПОСЛЕДНИМ: команды и кнопки меню обрабатываются раньше. */
export const textSessionDispatcher = new Composer<BotContext>();
textSessionDispatcher.on('message:text', (ctx, next) =>
  dispatchText(ctx, next),
);

export const sessionGuardMiddleware = (
  ctx: BotContext,
  next: NextFunction,
): Promise<void> => sessionGuard(ctx, next);
