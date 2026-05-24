import { bot } from './bot/instance.js';
import {
  authMiddleware,
  wizardGuardMiddleware,
} from './bot/middleware/index.js';
import {
  roleCommands,
  tournamentCommands,
  registrationCommands,
  adminParticipantCommands,
  matchCommands,
  helpCommands,
} from './bot/handlers/index.js';
import { sendOnboarding } from './bot/handlers/helpCommand.js';
import { setupCommands, setAdminCommands } from './bot/commands.js';
import { createAdminServer } from './admin/server/index.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { InlineKeyboard } from 'grammy';
import { randomBytes } from 'crypto';
import { db } from './db/db.js';
import { loginTokens } from './db/schema.js';

bot.use(authMiddleware);
bot.use(wizardGuardMiddleware);
bot.use(roleCommands);
bot.use(tournamentCommands);
bot.use(registrationCommands);
bot.use(matchCommands);
bot.use(adminParticipantCommands);
bot.use(helpCommands);

bot.command('start', async (ctx) => {
  if (ctx.dbUser.role === 'admin') {
    await setAdminCommands(bot, ctx.from!.id);
  }

  const name = ctx.dbUser.name ?? ctx.dbUser.username;
  await sendOnboarding(ctx, `Привет, ${name}!`);
});

bot.command('dashboard', async (ctx) => {
  if (ctx.dbUser.role !== 'admin') {
    return;
  }

  const token = randomBytes(16).toString('hex');
  await db.insert(loginTokens).values({
    token,
    userId: ctx.dbUser.id,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  const url = `https://cuebot.ru/api/auth/token?t=${token}`;

  const keyboard = new InlineKeyboard().webApp(
    'Открыть панель управления',
    url,
  );
  await ctx.reply('Ссылка действительна 5 минут', { reply_markup: keyboard });
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

async function start() {
  await setupCommands(bot);
  bot.start();

  const app = createAdminServer();

  // Serve static files from admin/dist in production
  if (process.env.NODE_ENV === 'production') {
    app.use('/*', serveStatic({ root: './admin/dist' }));
    app.get('/*', serveStatic({ path: './admin/dist/index.html' }));
  }

  const port = Number(process.env.ADMIN_PORT ?? 3000);
  serve({ fetch: app.fetch, port });
}

start();
