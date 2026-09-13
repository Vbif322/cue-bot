import { describe, it, expect, vi } from 'vitest';
import { Context } from 'grammy';
import type { Api, NextFunction } from 'grammy';
import type { Update, UserFromGetMe } from 'grammy/types';

import { chatScopeMiddleware } from '@/bot/middleware/chatScope.js';
import { MENU_BUTTONS } from '@/bot/ui/mainMenu.js';
import type { BotContext } from '@/bot/types.js';

const BOT = {
  id: 42,
  is_bot: true,
  first_name: 'Cue',
  username: 'cue_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
} as unknown as UserFromGetMe;

const USER = { id: 7, is_bot: false, first_name: 'Игрок' };

/**
 * Настоящий grammY Context, а не каст: иначе тест прошёл бы, даже если
 * middleware читает не то поле (hasCommand/chat/myChatMember — геттеры,
 * зависящие от разбора entities).
 */
function ctxOf(update: Partial<Update>): BotContext {
  const api = { raw: {} } as unknown as Api;
  return new Context(
    { update_id: 1, ...update } as Update,
    api,
    BOT,
  ) as BotContext;
}

function textMessage(
  chat: Record<string, unknown>,
  text: string,
): Partial<Update> {
  const entities = text.startsWith('/')
    ? [
        {
          type: 'bot_command' as const,
          offset: 0,
          length: text.split(' ')[0]?.length ?? 0,
        },
      ]
    : undefined;

  return {
    message: {
      message_id: 1,
      date: 0,
      chat,
      from: USER,
      text,
      ...(entities ? { entities } : {}),
    },
  } as unknown as Partial<Update>;
}

const PRIVATE = { id: 7, type: 'private', first_name: 'Игрок' };
const GROUP = { id: -100, type: 'group', title: 'Клуб' };
const SUPERGROUP = { id: -1001, type: 'supergroup', title: 'Клуб' };

async function run(update: Partial<Update>): Promise<boolean> {
  const next = vi.fn<NextFunction>().mockResolvedValue(undefined);
  await chatScopeMiddleware(ctxOf(update), next);
  return next.mock.calls.length > 0;
}

describe('chatScopeMiddleware', () => {
  describe('личка проходит целиком', () => {
    it('обычный текст', async () => {
      expect(await run(textMessage(PRIVATE, 'привет'))).toBe(true);
    });

    it('любая команда', async () => {
      expect(await run(textMessage(PRIVATE, '/tournaments'))).toBe(true);
    });

    it('callback_query', async () => {
      const update = {
        callback_query: {
          id: 'cb',
          from: USER,
          chat_instance: 'x',
          data: 'reg:join:abc',
          message: { message_id: 1, date: 0, chat: PRIVATE },
        },
      } as unknown as Partial<Update>;

      expect(await run(update)).toBe(true);
    });
  });

  describe('группа: всё лишнее отбрасывается', () => {
    it('произвольный текст не доходит до хендлеров', async () => {
      expect(await run(textMessage(GROUP, '3:2'))).toBe(false);
    });

    it.each(Object.values(MENU_BUTTONS))(
      'фраза главного меню «%s» не выгружает список в чат',
      async (phrase) => {
        expect(await run(textMessage(GROUP, phrase))).toBe(false);
      },
    );

    it('команда не из белого списка отбрасывается', async () => {
      expect(await run(textMessage(GROUP, '/tournaments'))).toBe(false);
    });

    it('callback_query из супергруппы отбрасывается', async () => {
      const update = {
        callback_query: {
          id: 'cb',
          from: USER,
          chat_instance: 'x',
          data: 'reg:join:abc',
          message: { message_id: 1, date: 0, chat: SUPERGROUP },
        },
      } as unknown as Partial<Update>;

      expect(await run(update)).toBe(false);
    });

    it('отбрасывает молча — ничего не отвечает в чат', async () => {
      const ctx = ctxOf(textMessage(GROUP, 'привет'));
      const reply = vi.spyOn(ctx, 'reply').mockResolvedValue({} as never);

      await chatScopeMiddleware(ctx, vi.fn<NextFunction>());

      expect(reply).not.toHaveBeenCalled();
    });
  });

  describe('группа: белый список проходит', () => {
    it.each(['/start_announcements', '/stop_announcements'])(
      '%s',
      async (command) => {
        expect(await run(textMessage(GROUP, command))).toBe(true);
      },
    );

    it('команда с упоминанием бота', async () => {
      expect(
        await run(textMessage(SUPERGROUP, '/stop_announcements@cue_bot')),
      ).toBe(true);
    });

    it('my_chat_member проходит — иначе не узнаем о добавлении бота', async () => {
      const update = {
        my_chat_member: {
          chat: GROUP,
          from: USER,
          date: 0,
          old_chat_member: { status: 'left', user: BOT },
          new_chat_member: { status: 'member', user: BOT },
        },
      } as unknown as Partial<Update>;

      expect(await run(update)).toBe(true);
    });
  });

  it('канал не обслуживается', async () => {
    const update = {
      channel_post: {
        message_id: 1,
        date: 0,
        chat: { id: -100500, type: 'channel', title: 'Канал' },
        text: 'привет',
      },
    } as unknown as Partial<Update>;

    expect(await run(update)).toBe(false);
  });

  it('апдейт без чата проходит', async () => {
    const update = {
      poll_answer: { poll_id: 'p', user: USER, option_ids: [0] },
    } as unknown as Partial<Update>;

    expect(await run(update)).toBe(true);
  });
});
