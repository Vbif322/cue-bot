import { bot } from "./bot/instance.js";
import { authMiddleware } from "./bot/middleware/index.js";
import {
  roleCommands,
  tournamentCommands,
  registrationCommands,
  matchCommands,
} from "./bot/handlers/index.js";
import { setupCommands, setAdminCommands } from "./bot/commands.js";
import { createAdminServer } from "./admin/server/index.js";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { InlineKeyboard } from "grammy";
import { randomBytes } from "crypto";
import { db } from "./db/db.js";
import { loginTokens } from "./db/schema.js";

bot.use(authMiddleware);
bot.use(roleCommands);
bot.use(tournamentCommands);
bot.use(registrationCommands);
bot.use(matchCommands);

bot.command("start", async (ctx) => {
  if (ctx.dbUser.role === "admin") {
    await setAdminCommands(bot, ctx.from!.id);
  }

  await ctx.reply(
    `Привет, ${ctx.dbUser.name ?? ctx.dbUser.username}!` +
      (process.env.NODE_ENV === "development"
        ? `\nВаша роль: ${ctx.dbUser.role}`
        : "") +
      "\n\n" +
      "Нажмите / чтобы увидеть доступные команды",
  );
});

bot.command("dashboard", async (ctx) => {
  if (ctx.dbUser.role !== "admin") {
    return;
  }

  const token = randomBytes(16).toString("hex");
  await db.insert(loginTokens).values({
    token,
    userId: ctx.dbUser.id,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  const adminUrl =
    process.env.ADMIN_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:5173"
      : `http://localhost:${process.env.ADMIN_PORT ?? 3000}`);
  const url = `${adminUrl}/api/auth/token?t=${token}`;

  const isPublicUrl =
    adminUrl.startsWith("https://") && !adminUrl.includes("localhost");
  if (isPublicUrl) {
    const keyboard = new InlineKeyboard().url("Открыть панель управления", url);
    await ctx.reply("Ссылка действительна 5 минут", { reply_markup: keyboard });
  } else {
    await ctx.reply(`Ссылка действительна 5 минут:\n${url}`);
  }
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

async function start() {
  await setupCommands(bot);
  bot.start();

  const app = createAdminServer();

  // Serve static files from admin/dist in production
  if (process.env.NODE_ENV === "production") {
    app.use("/*", serveStatic({ root: "./admin/dist" }));
  }

  const port = Number(process.env.ADMIN_PORT ?? 3000);
  serve({ fetch: app.fetch, port });
}

start();
