import type { BotCommand } from 'grammy/types';
import type { Bot } from 'grammy';

import type { BotContext } from './types.js';

const userCommands: BotCommand[] = [
  { command: 'start', description: 'Начать работу с ботом' },
  { command: 'help', description: 'Как пользоваться ботом' },
  { command: 'tournaments', description: 'Список турниров' },
  { command: 'my_tournaments', description: 'Мои турниры' },
  { command: 'my_matches', description: 'Все мои активные матчи' },
  { command: 'me', description: 'Профиль и статистика' },
];

// В группе бот отвечает только на эти две команды — всё остальное отсекает
// chatScopeMiddleware, поэтому рекламировать там userCommands значило бы
// показывать меню из мёртвых пунктов.
//
// Показываем их ТОЛЬКО администраторам чата (scope all_chat_administrators):
// распоряжаться анонсами всё равно может только админ, и незачем светить
// рядовым участникам команды, на которые они получат отказ.
//
// ВАЖНО: scope — это только меню по «/», а не авторизация. Команду по-прежнему
// может НАБРАТЬ кто угодно, поэтому проверка прав в groupCommands.ts
// (canManageAnnouncements) остаётся обязательной.
const groupCommands: BotCommand[] = [
  { command: 'start_announcements', description: 'Включить анонсы турниров' },
  { command: 'stop_announcements', description: 'Отключить анонсы турниров' },
];

const refereeCommands: BotCommand[] = [
  ...userCommands,
  { command: 'referee_matches', description: 'Матчи турниров, где я судья' },
];

const adminCommands: BotCommand[] = [
  ...refereeCommands,
  { command: 'cancel', description: 'Отменить wizard' },
  { command: 'create_tournament', description: 'Создать турнир' },
  { command: 'dashboard', description: 'Панель администратора' },
  { command: 'delete_tournament', description: 'Удалить турнир' },
  { command: 'set_admin', description: 'Назначить администратора' },
  { command: 'remove_admin', description: 'Снять администратора' },
  { command: 'assign_referee', description: 'Назначить судью на турнир' },
  { command: 'remove_referee', description: 'Снять судью с турнира' },
];

export async function setupCommands(bot: Bot<BotContext>): Promise<void> {
  // Команды для всех пользователей в личных чатах
  try {
    await bot.api.setMyCommands(userCommands, {
      scope: { type: 'all_private_chats' },
    });

    // Рядовые участники групп не видят в меню ничего: все групповые команды
    // админские. Пустой список здесь обязателен — иначе более широкий scope
    // подставил бы их всем (Telegram берёт самый узкий ПОДХОДЯЩИЙ scope).
    await bot.api.setMyCommands([], {
      scope: { type: 'all_group_chats' },
    });

    // Команды для администраторов групповых чатов
    await bot.api.setMyCommands(groupCommands, {
      scope: { type: 'all_chat_administrators' },
    });
  } catch (error) {
    console.error(error);
  }
}

export async function setAdminCommands(
  bot: Bot<BotContext>,
  chatId: number,
): Promise<void> {
  await bot.api.setMyCommands(adminCommands, {
    scope: { type: 'chat', chat_id: chatId },
  });
}

export async function setUserCommands(
  bot: Bot<BotContext>,
  chatId: number,
): Promise<void> {
  await bot.api.setMyCommands(userCommands, {
    scope: { type: 'chat', chat_id: chatId },
  });
}

export async function setRefereeCommands(
  bot: Bot<BotContext>,
  chatId: number,
): Promise<void> {
  await bot.api.setMyCommands(refereeCommands, {
    scope: { type: 'chat', chat_id: chatId },
  });
}

export { userCommands, groupCommands, refereeCommands, adminCommands };
