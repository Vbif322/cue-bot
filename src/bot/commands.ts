import type { BotCommand } from "grammy/types";
import type { Bot } from "grammy";
import type { BotContext } from "./types.js";

const userCommands: BotCommand[] = [
  { command: "start", description: "Начать работу с ботом" },
  { command: "tournaments", description: "Список турниров" },
  { command: "tournament", description: "Информация о турнире" },
  { command: "my_tournaments", description: "Мои турниры" },
  { command: "my_match", description: "Мой текущий матч" },
  { command: "bracket", description: "Сетка турнира" },
];

const adminCommands: BotCommand[] = [
  ...userCommands,
  { command: "create_tournament", description: "Создать турнир" },
  { command: "delete_tournament", description: "Удалить турнир" },
  { command: "set_admin", description: "Назначить администратора" },
  { command: "remove_admin", description: "Снять администратора" },
  { command: "assign_referee", description: "Назначить судью на турнир" },
  { command: "remove_referee", description: "Снять судью с турнира" },
];

export async function setupCommands(bot: Bot<BotContext>): Promise<void> {
  // Команды для всех пользователей в личных чатах
  try {
    await bot.api.setMyCommands(userCommands, {
      scope: { type: "all_private_chats" },
    });

    // Команды для групповых чатов
    await bot.api.setMyCommands(userCommands, {
      scope: { type: "all_group_chats" },
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
    scope: { type: "chat", chat_id: chatId },
  });
}

export async function setUserCommands(
  bot: Bot<BotContext>,
  chatId: number,
): Promise<void> {
  await bot.api.setMyCommands(userCommands, {
    scope: { type: "chat", chat_id: chatId },
  });
}

export { userCommands, adminCommands };
