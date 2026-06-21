import { bot } from './bot/instance.js';
import {
  authMiddleware,
  wizardGuardMiddleware,
} from './bot/middleware/index.js';
import {
  roleCommands,
  tournamentCommands,
  registrationCommands,
  inviteCommands,
  adminParticipantCommands,
  matchCommands,
  helpCommands,
  profileCommands,
  menuHandlers,
} from './bot/handlers/index.js';
import {
  joinViaInvite,
  parseStartPayload,
} from './bot/handlers/inviteCommands.js';
import { getTournamentByInviteCode } from './services/tournamentService.js';
import { sendOnboarding } from './bot/handlers/helpCommand.js';
import {
  setupCommands,
  setAdminCommands,
  setRefereeCommands,
  setUserCommands,
} from './bot/commands.js';
import { getUserRefereeTournaments } from './bot/permissions.js';
import { buildMainMenuKeyboard } from './bot/ui/mainMenu.js';
import { createAdminServer } from './admin/server/index.js';
import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { InlineKeyboard } from 'grammy';
import { randomBytes } from 'crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { db } from './db/db.js';
import { loginTokens } from './db/schema.js';

bot.use(authMiddleware);
bot.use(wizardGuardMiddleware);
bot.use(menuHandlers);
bot.use(roleCommands);
bot.use(inviteCommands);
bot.use(tournamentCommands);
bot.use(registrationCommands);
bot.use(matchCommands);
bot.use(adminParticipantCommands);
bot.use(helpCommands);
bot.use(profileCommands);

bot.command('start', async (ctx) => {
  if (!ctx.from) return;
  const chatId = ctx.from.id;

  if (ctx.dbUser.role === 'admin') {
    await setAdminCommands(bot, chatId);
  } else {
    const refereeTournamentIds = await getUserRefereeTournaments(ctx.dbUser.id);
    if (refereeTournamentIds.length > 0) {
      await setRefereeCommands(bot, chatId);
    } else {
      await setUserCommands(bot, chatId);
    }
  }

  const name = ctx.dbUser.name ?? ctx.dbUser.username;
  await ctx.reply(`Привет, ${name}!`, {
    reply_markup: buildMainMenuKeyboard(),
  });

  // Deep-link invite: /start join_<code>
  const payload = parseStartPayload(ctx.match);
  if (payload?.kind === 'join') {
    const tournament = await getTournamentByInviteCode(payload.code);
    if (tournament) {
      await joinViaInvite(ctx, tournament);
      return;
    }
    await ctx.reply('Приглашение недействительно или турнир не найден.');
    return;
  }

  await sendOnboarding(ctx);
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

const MAX_BOT_START_RETRIES = 5;
const BOT_START_RETRY_DELAY_MS = 5000;

// bot.start() резолвится только при bot.stop(), а его внутренний polling уже сам
// ретраит транзиентные ошибки. Незакрытый зазор — начальная инициализация
// (getMe / setMyCommands), поэтому ретраим именно её, а сам polling не ждём.
async function startBot() {
  for (let attempt = 1; attempt <= MAX_BOT_START_RETRIES; attempt++) {
    try {
      await bot.init();
      await setupCommands(bot);

      void bot
        .start({
          onStart: (info) => {
            console.log(`Бот @${info.username} запущен`);
          },
        })
        .catch((err: unknown) => {
          console.error('Long polling остановлен с ошибкой:', err);
        });
      return;
    } catch (err) {
      console.error(
        `Не удалось запустить бота (попытка ${String(attempt)}/${String(MAX_BOT_START_RETRIES)}):`,
        err,
      );
      if (attempt < MAX_BOT_START_RETRIES) {
        await sleep(BOT_START_RETRY_DELAY_MS);
      }
    }
  }

  console.error(
    'Бот не запустился после всех попыток; admin API продолжает работать без бота.',
  );
}

let server: ServerType | undefined;

async function start() {
  // Поднимаем HTTP-сервер первым, чтобы admin API был доступен независимо от бота.
  const app = createAdminServer();

  // Serve static files from admin/dist in production
  if (process.env.NODE_ENV === 'production') {
    app.use('/*', serveStatic({ root: './admin/dist' }));
    app.get('/*', serveStatic({ path: './admin/dist/index.html' }));
  }

  const port = Number(process.env.ADMIN_PORT ?? 3000);
  server = serve({ fetch: app.fetch, port });

  await startBot();
}

start().catch((err: unknown) => {
  console.error('Фатальная ошибка запуска:', err);
  process.exit(1);
});

const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Получен ${signal}, завершаем работу...`);

  // Страховка: если что-то зависнет при остановке, не блокируем выход навсегда.
  const watchdog = setTimeout(() => {
    console.error('Превышено время graceful shutdown, принудительный выход.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  watchdog.unref();

  // 1. Останавливаем приём новых апдейтов от Telegram.
  try {
    await bot.stop();
    console.log('Бот остановлен');
  } catch (err) {
    console.error('Ошибка при остановке бота:', err);
  }

  // 2. Перестаём принимать новые HTTP-запросы, дожидаемся завершения текущих.
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      console.log('HTTP-сервер закрыт');
      resolve();
    });
  });

  // 3. Дренируем пул соединений с БД.
  try {
    await db.$client.end();
    console.log('Пул БД закрыт');
  } catch (err) {
    console.error('Ошибка при закрытии пула БД:', err);
  }

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Необработанный rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Необработанное исключение:', err);
  process.exit(1);
});
