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
  // console.log(`Admin panel running at http://localhost:${port}`);
}

start();
