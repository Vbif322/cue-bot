import { Bot } from "grammy";
import type { BotContext } from "./bot/types.js";
import { authMiddleware } from "./bot/middleware/index.js";
import {
  roleCommands,
  tournamentCommands,
  registrationCommands,
} from "./bot/handlers/index.js";
import { setupCommands, setAdminCommands } from "./bot/commands.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set");
}

const bot = new Bot<BotContext>(token);

bot.use(authMiddleware);
bot.use(roleCommands);
bot.use(tournamentCommands);
bot.use(registrationCommands);

bot.command("start", async (ctx) => {
  // Обновляем команды для пользователя при старте
  if (ctx.dbUser.role === "admin") {
    await setAdminCommands(bot, ctx.from!.id);
  }

  await ctx.reply(
    `Привет, ${ctx.dbUser.name ?? ctx.dbUser.username}!` +
      (process.env.NODE_ENV === "development" ? `\nВаша роль: ${ctx.dbUser.role}` : "") +
      "\n\n" +
      "Нажмите / чтобы увидеть доступные команды"
  );
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

// Запуск бота
async function start() {
  await setupCommands(bot);
  bot.start();
}

start();
