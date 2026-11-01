import { Composer } from 'grammy';
import type { UUID } from 'crypto';

import {
  activateGroupChat,
  bindGroupChat,
  classifyMyChatMember,
  deactivateGroupChat,
  getGroupChat,
  registerGroupChat,
} from '@/services/groupChatService.js';
import type { IGroupChatType } from '@/db/schema.js';
import { errorMessage } from '@/utils/errors.js';

import { isAdmin } from '../permissions.js';
import { getUserFederations } from '@/services/federationService.js';
import type { BotContext } from '../types.js';

export const groupCommands = new Composer<BotContext>();

/**
 * Telegram подставляет этот id как отправителя, когда в группе пишет анонимный
 * администратор. Реального пользователя за ним нет, поэтому ни в `added_by`,
 * ни в проверку прав он не годится.
 */
const GROUP_ANONYMOUS_BOT_ID = 1087968824;

const GREETING =
  'Привет! Я буду присылать сюда анонсы об открытии регистрации на турниры';

/** Групповой чат из контекста — или null, если это не группа. */
function groupChatOf(
  ctx: BotContext,
): { id: number; type: IGroupChatType; title: string | null } | null {
  const chat = ctx.chat;
  if (!chat) return null;
  if (chat.type !== 'group' && chat.type !== 'supergroup') return null;

  return { id: chat.id, type: chat.type, title: chat.title };
}

/** Пользователь, которому можно приписать действие (не анонимный админ). */
function actorIdOf(ctx: BotContext): UUID | null {
  if (ctx.from?.id === GROUP_ANONYMOUS_BOT_ID) return null;
  return ctx.dbUser.id;
}

/**
 * Управлять анонсами может администратор чата или платформенный админ.
 * Анонимные администраторы через `getChatMember` не проверяются — считаем их
 * не-админами (задокументированное ограничение).
 */
async function canManageAnnouncements(ctx: BotContext): Promise<boolean> {
  if (isAdmin(ctx)) return true;

  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (chatId === undefined || userId === undefined) return false;
  if (userId === GROUP_ANONYMOUS_BOT_ID) return false;

  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    return member.status === 'creator' || member.status === 'administrator';
  } catch (error) {
    console.error('Не удалось проверить права в чате:', errorMessage(error));
    return false;
  }
}

/**
 * Привязан ли чат к федерации. В непривязанный чат бот не пишет НИЧЕГО — ни
 * анонсов, ни приветствия, ни ответов на команды: пока чат ничей, его
 * участникам бот ничего не обещает.
 */
async function isBound(chatId: string): Promise<boolean> {
  return ((await getGroupChat(chatId))?.federationId ?? null) !== null;
}

/**
 * Бота добавили в чат / выгнали / сменили ему права.
 *
 * Разбор вынесен в чистую `classifyMyChatMember`, здесь остаётся только
 * применение — по конвенции «хендлеры тонкие».
 */
groupCommands.on('my_chat_member', async (ctx) => {
  const chat = groupChatOf(ctx);
  if (!chat) return;

  const action = classifyMyChatMember(ctx.myChatMember);
  const chatId = String(chat.id);

  if (action.kind === 'leave') {
    await deactivateGroupChat(chatId, `my_chat_member:${action.status}`);
    return;
  }

  if (action.kind === 'ignore') return;

  await registerGroupChat({
    chatId,
    type: chat.type,
    title: chat.title,
    addedBy: actorIdOf(ctx),
  });

  // Новый чат ещё не привязан — не здороваемся. Привязанным бывает только
  // повторно добавленный чат (`registerGroupChat` привязку не сбрасывает).
  if (!action.greet || !(await isBound(chatId))) return;

  try {
    // sendMessage, а не ctx.reply: my_chat_member — не сообщение, отвечать не на что.
    await ctx.api.sendMessage(chat.id, GREETING, { parse_mode: 'Markdown' });
  } catch (error) {
    // Бота могли добавить без права писать — подписку это не отменяет.
    console.error('Не удалось поздороваться в чате:', errorMessage(error));
  }
});

/**
 * Включить анонсы. Это же — ЕДИНСТВЕННЫЙ путь бэкфилла: Telegram не
 * переигрывает `my_chat_member`, поэтому группы, где бот уже состоял на момент
 * релиза, иначе не получили бы ничего никогда. Поэтому команда СОЗДАЁТ строку
 * из `ctx.chat`, а не только переключает флаг.
 */
groupCommands.command('start_announcements', async (ctx) => {
  const chat = groupChatOf(ctx);
  if (!chat) return;

  const chatId = String(chat.id);
  const existing = await getGroupChat(chatId);

  if (!(await canManageAnnouncements(ctx))) {
    if ((existing?.federationId ?? null) !== null) {
      await ctx.reply('Управлять анонсами может только администратор чата.');
    }
    return;
  }

  const actorId = actorIdOf(ctx);

  if (existing === undefined) {
    await registerGroupChat({
      chatId,
      type: chat.type,
      title: chat.title,
      addedBy: actorId,
    });
  } else {
    await activateGroupChat(chatId);
  }

  // Привязка к организации (M8): если включивший состоит ровно в одной
  // федерации, а чат ещё не привязан — привязываем молча. Несколько федераций
  // — выбор делается в панели управления; ноль — чат молчит до привязки там же.
  let bound = existing?.federationId ?? null;
  let hint = '';
  if (bound === null && actorId !== null) {
    const mine = await getUserFederations(actorId);
    const only = mine[0];
    if (mine.length === 1 && only) {
      await bindGroupChat(chatId, only.id);
      bound = only.id;
      hint = `\nЧат привязан к организации «${only.name}»: сюда придут только её турниры. Изменить — в панели управления.`;
    }
  }

  // Непривязанный чат уже зарегистрирован и виден в панели как кандидат на
  // привязку — но писать в него не о чем: анонсы туда не придут.
  if (bound === null) return;

  await ctx.reply(`Анонсы турниров включены для этого чата.${hint}`);
});

groupCommands.command('stop_announcements', async (ctx) => {
  const chat = groupChatOf(ctx);
  if (!chat) return;

  const chatId = String(chat.id);
  const bound = await isBound(chatId);

  if (!(await canManageAnnouncements(ctx))) {
    if (bound) {
      await ctx.reply('Управлять анонсами может только администратор чата.');
    }
    return;
  }

  await deactivateGroupChat(chatId, 'command:stop_announcements');
  if (!bound) return;
  await ctx.reply(
    'Анонсы турниров отключены. Включить обратно: /start\\_announcements',
    { parse_mode: 'Markdown' },
  );
});
