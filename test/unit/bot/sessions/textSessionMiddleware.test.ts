import { describe, expect, it, vi } from 'vitest';
import { Context } from 'grammy';
import type { Api } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';

import {
  dispatchText,
  handleCancel,
  sessionGuard,
  type TextSessionDeps,
} from '@/bot/sessions/textSessionMiddleware.js';
import type {
  ActiveTextSession,
  RegisteredTextSession,
  TextMessageContext,
} from '@/bot/sessions/textSessionRegistry.js';
import { MENU_BUTTONS } from '@/bot/ui/mainMenu.js';
import type { BotContext } from '@/bot/types.js';

const BOT = {
  id: 42,
  is_bot: true,
  first_name: 'Cue',
  username: 'cue_bot',
} as unknown as UserFromGetMe;

const USER = { id: 7, is_bot: false, first_name: 'Игрок' };
const PRIVATE = { id: 7, type: 'private', first_name: 'Игрок' };
const GROUP = { id: -100, type: 'supergroup', title: 'Клуб' };

/** Настоящий grammY Context; ответы бота перехватываются шпионами. */
function ctxOf(update: Partial<Update>) {
  const api = { raw: {} } as unknown as Api;
  const ctx = new Context({ update_id: 1, ...update }, api, BOT) as BotContext;
  const reply = vi.fn().mockResolvedValue(undefined);
  const answerCallbackQuery = vi.fn().mockResolvedValue(true);
  Object.assign(ctx, { reply, answerCallbackQuery });
  return { ctx, reply, answerCallbackQuery };
}

function text(value: string, chat: Record<string, unknown> = PRIVATE) {
  const entities = value.startsWith('/')
    ? [
        {
          type: 'bot_command' as const,
          offset: 0,
          length: value.split(' ')[0]?.length ?? 0,
        },
      ]
    : undefined;
  return ctxOf({
    message: {
      message_id: 1,
      date: 0,
      chat,
      from: USER,
      text: value,
      ...(entities ? { entities } : {}),
    },
  } as unknown as Partial<Update>);
}

function callback(data: string) {
  return ctxOf({
    callback_query: {
      id: '1',
      from: USER,
      chat_instance: 'x',
      data,
      message: { message_id: 1, date: 0, chat: PRIVATE },
    },
  } as unknown as Partial<Update>);
}

function session(
  overrides: Partial<RegisteredTextSession> = {},
): RegisteredTextSession {
  return {
    namespace: 'tc',
    name: 'создание турнира',
    blocking: true,
    callbackPrefix: 'tc:',
    cancelReply: 'Создание турнира отменено.',
    handleText: vi.fn().mockResolvedValue(undefined),
    handleEnd: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const SOFT_OVERRIDES = {
  namespace: 'match-schedule',
  name: 'назначение времени матча',
  blocking: false,
  callbackPrefix: undefined,
  cancelReply: 'Назначение времени отменено.',
} as const;

function deps(active: ActiveTextSession | undefined, ended = true) {
  const d = {
    lookup: vi.fn().mockResolvedValue(active),
    end: vi.fn().mockResolvedValue(ended),
  };
  return d as typeof d & TextSessionDeps;
}

describe('sessionGuard', () => {
  it('does not even look up the session for plain text', async () => {
    const d = deps({ session: session(), data: {} });
    const next = vi.fn();
    await sessionGuard(text('Кубок').ctx, next, d);

    expect(next).toHaveBeenCalledOnce();
    expect(d.lookup).not.toHaveBeenCalled();
  });

  it('blocks a menu button during a blocking session', async () => {
    const d = deps({ session: session(), data: {} });
    const next = vi.fn();
    const { ctx, reply } = text(MENU_BUTTONS.matches);
    await sessionGuard(ctx, next, d);

    expect(next).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.stringContaining('Вы находитесь в процессе: создание турнира'),
    );
  });

  it('blocks a foreign callback during a blocking session', async () => {
    const d = deps({ session: session(), data: {} });
    const next = vi.fn();
    const { ctx, answerCallbackQuery } = callback('match:view:1');
    await sessionGuard(ctx, next, d);

    expect(next).not.toHaveBeenCalled();
    expect(answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Сначала завершите или отмените создание турнира',
    });
  });

  it('ends a soft session on a command, then runs the command', async () => {
    const active = { session: session(SOFT_OVERRIDES), data: { matchId: 'm' } };
    const d = deps(active);
    const next = vi.fn();
    const { ctx } = text('/tournaments');
    await sessionGuard(ctx, next, d);

    expect(d.end).toHaveBeenCalledWith(ctx, USER.id, active, 'superseded');
    expect(next).toHaveBeenCalledOnce();
  });

  it('keeps a soft session on callbacks', async () => {
    const d = deps({ session: session(SOFT_OVERRIDES), data: {} });
    const next = vi.fn();
    await sessionGuard(callback('match:view:1').ctx, next, d);

    expect(d.end).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('ignores group chats', async () => {
    const d = deps({ session: session(), data: {} });
    const next = vi.fn();
    await sessionGuard(text('/tournaments', GROUP).ctx, next, d);

    expect(d.lookup).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('handleCancel', () => {
  it('ends the active session of any flow and replies with its text', async () => {
    const active = { session: session(SOFT_OVERRIDES), data: { matchId: 'm' } };
    const d = deps(active);
    const { ctx, reply } = text('/cancel');
    await handleCancel(ctx, d);

    expect(d.end).toHaveBeenCalledWith(ctx, USER.id, active, 'cancel');
    expect(reply).toHaveBeenCalledWith('Назначение времени отменено.');
  });

  it('says there is nothing to cancel without a session', async () => {
    const d = deps(undefined);
    const { ctx, reply } = text('/cancel');
    await handleCancel(ctx, d);

    expect(d.end).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith('Нечего отменять.');
  });

  it('says there is nothing to cancel when the session ended concurrently', async () => {
    const d = deps({ session: session(), data: {} }, false);
    const { ctx, reply } = text('/cancel');
    await handleCancel(ctx, d);

    expect(reply).toHaveBeenCalledWith('Нечего отменять.');
  });
});

describe('dispatchText', () => {
  it('routes plain text to the active session', async () => {
    const s = session();
    const data = { step: 'name' };
    const d = deps({ session: s, data });
    const next = vi.fn();
    const { ctx } = text('Кубок');
    await dispatchText(ctx as TextMessageContext, next, d);

    expect(s.handleText).toHaveBeenCalledWith(ctx, data);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes through without a session', async () => {
    const d = deps(undefined);
    const next = vi.fn();
    await dispatchText(text('Кубок').ctx as TextMessageContext, next, d);

    expect(next).toHaveBeenCalledOnce();
  });

  it('never routes commands', async () => {
    const s = session();
    const d = deps({ session: s, data: {} });
    const next = vi.fn();
    await dispatchText(text('/unknown').ctx as TextMessageContext, next, d);

    expect(s.handleText).not.toHaveBeenCalled();
    expect(d.lookup).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
