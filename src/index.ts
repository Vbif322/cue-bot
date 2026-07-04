import { bot } from './bot/instance.js';
import {
  authMiddleware,
  wizardGuardMiddleware,
  rateLimitMiddleware,
  botFloodLimiter,
} from './bot/middleware/index.js';
import { RateLimiter } from './lib/rateLimiter.js';
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
import type { MiddlewareHandler } from 'hono';
import { InlineKeyboard } from 'grammy';
import { randomBytes } from 'crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { db } from './db/db.js';
import { loginTokens } from './db/schema.js';
import { sweepExpiredDialogSessions } from './services/dialogSessionStore.js';
import { sweepExpiredEmailLoginCodes } from './services/emailLoginCodeService.js';
import { assertMailConfigured } from './services/mailService.js';
import { emailCodeLimiter } from './app/server/routes/auth.js';

// Flood protection runs first so spam is dropped before authMiddleware's per-update
// user upsert (a DB transaction) ever runs.
bot.use(rateLimitMiddleware);
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

// Stricter cooldown on token minting (1 per 30s per admin) so the loginTokens table
// can't be spammed full. Admin-only command, so this is bloat protection, not anti-abuse.
const dashboardLimiter = new RateLimiter({ capacity: 1, refillPerSec: 1 / 30 });

// Base URL of the public (player) deployment and the Telegram webhook. Required in
// production (validated in startBot before setWebhook); unused in dev, which uses
// long polling and an HTTPS tunnel for web_app testing (see README).
const publicBaseUrl = process.env.PUBLIC_BASE_URL;

// Base URL of the admin deployment (a separate subdomain). Drives the /dashboard
// login link, the Host-based static dispatch, and the /token redirect shim. Required
// in production (validated at startup below); unused in dev, where Node serves no
// static and the shim is prod-gated.
const adminBaseUrl = process.env.ADMIN_BASE_URL;

bot.command('dashboard', async (ctx) => {
  if (ctx.dbUser.role !== 'admin') {
    return;
  }

  // ADMIN_BASE_URL is required in production (enforced at startup); if it's unset
  // we're in dev, where the HTTPS web_app link wouldn't work anyway (use dev:login).
  if (!adminBaseUrl) {
    await ctx.reply('Панель управления недоступна: ADMIN_BASE_URL не задан.');
    return;
  }

  if (!dashboardLimiter.hit(ctx.dbUser.id).allowed) {
    await ctx.reply('Не так часто. Попробуйте через минуту.');
    return;
  }

  const token = randomBytes(16).toString('hex');
  await db.insert(loginTokens).values({
    token,
    userId: ctx.dbUser.id,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  const url = `${adminBaseUrl}/api/auth/token?t=${token}`;

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

// В production бот получает обновления через вебхук (Telegram пушит их на HTTP-эндпоинт),
// в dev — через long polling (нет публичного HTTPS-URL). Переключатель — NODE_ENV,
// как и для отдачи статики SPA.
const useWebhook = process.env.NODE_ENV === 'production';

// bot.start() резолвится только при bot.stop(), а его внутренний polling уже сам
// ретраит транзиентные ошибки. Незакрытый зазор — начальная инициализация
// (getMe / setMyCommands / setWebhook), поэтому ретраим именно её, а сам polling не ждём.
async function startBot() {
  for (let attempt = 1; attempt <= MAX_BOT_START_RETRIES; attempt++) {
    try {
      await bot.init();
      await setupCommands(bot);

      if (useWebhook) {
        const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
        if (!webhookSecret) {
          console.error(
            'TELEGRAM_WEBHOOK_SECRET не задан — вебхук не настроен, бот не получает обновления.',
          );
          return;
        }
        if (!publicBaseUrl) {
          console.error(
            'PUBLIC_BASE_URL не задан — вебхук не настроен, бот не получает обновления.',
          );
          return;
        }
        const webhookUrl = `${publicBaseUrl}/api/telegram/webhook/${webhookSecret}`;
        await bot.api.setWebhook(webhookUrl, {
          secret_token: webhookSecret,
          drop_pending_updates: false,
        });
        console.log(`Бот @${bot.botInfo.username} запущен (webhook на ${publicBaseUrl})`);
        return;
      }

      // Dev: перед polling снимаем возможный вебхук, иначе Telegram отвергнет getUpdates (409).
      await bot.api.deleteWebhook();
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
let dialogSessionSweep: ReturnType<typeof setInterval> | undefined;
let rateLimitSweep: ReturnType<typeof setInterval> | undefined;

const DIALOG_SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // раз в час
const RATE_LIMIT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // раз в 5 минут

async function start() {
  // Валидируем почтовое окружение до старта: в проде без SMTP вход по коду молча
  // не работал бы (см. assertMailConfigured), поэтому падаем громко на старте.
  assertMailConfigured();

  // Поднимаем HTTP-сервер первым, чтобы admin API был доступен независимо от бота.
  const app = createAdminServer();

  // Serve both SPAs' static files in production, dispatching by Host header: the
  // admin SPA (admin/dist) on the admin subdomain, the player SPA (app/dist) on
  // everything else (the public host). nginx just proxy_pass'es both vhosts here and
  // MUST forward the original Host (proxy_set_header Host $host), otherwise every
  // request falls through to the player SPA.
  //
  // Resolve dist paths from this module's location instead of process.cwd() so
  // static serving works regardless of the launch directory (S1-7). '../admin/dist'
  // and '../app/dist' are correct from both build/index.js and the dev src/index.ts.
  //
  // Registered here — AFTER createAdminServer() mounted /api/* and the telegram
  // webhook — so those precede these '/*' catch-alls (Hono matches in order).
  if (process.env.NODE_ENV === 'production') {
    if (!adminBaseUrl) {
      throw new Error(
        'ADMIN_BASE_URL environment variable is required in production',
      );
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const adminDist = resolve(here, '../admin/dist');
    const appDist = resolve(here, '../app/dist');
    const adminHost = new URL(adminBaseUrl).host;

    // Pick the admin or player middleware per request by Host header. Typed as
    // MiddlewareHandler so `c`/`next` line up with what serveStatic returns.
    const byHost =
      (admin: MiddlewareHandler, player: MiddlewareHandler): MiddlewareHandler =>
      (c, next) =>
        (c.req.header('host') === adminHost ? admin : player)(c, next);

    const adminStatic = serveStatic({ root: adminDist });
    const appStatic = serveStatic({ root: appDist });
    app.use('/*', byHost(adminStatic, appStatic));

    // SPA fallback: serve the matching dist's index.html for client-side routes.
    const adminIndex = serveStatic({ path: join(adminDist, 'index.html') });
    const appIndex = serveStatic({ path: join(appDist, 'index.html') });
    app.get('/*', byHost(adminIndex, appIndex));
  }

  const port = Number(process.env.ADMIN_PORT ?? 3000);
  server = serve({ fetch: app.fetch, port });

  // Периодически удаляем просроченные диалоговые сессии и коды входа, чтобы
  // таблицы не росли (чтения и так фильтруют по времени).
  dialogSessionSweep = setInterval(() => {
    sweepExpiredDialogSessions().catch((err: unknown) => {
      console.error('Ошибка очистки диалоговых сессий:', err);
    });
    sweepExpiredEmailLoginCodes().catch((err: unknown) => {
      console.error('Ошибка очистки кодов входа:', err);
    });
  }, DIALOG_SESSION_SWEEP_INTERVAL_MS);
  dialogSessionSweep.unref();

  // Освобождаем память от неактивных бакетов rate limiter'ов.
  rateLimitSweep = setInterval(() => {
    botFloodLimiter.prune();
    dashboardLimiter.prune();
    emailCodeLimiter.prune();
  }, RATE_LIMIT_SWEEP_INTERVAL_MS);
  rateLimitSweep.unref();

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

  // 0. Останавливаем периодические задачи очистки.
  if (dialogSessionSweep) clearInterval(dialogSessionSweep);
  if (rateLimitSweep) clearInterval(rateLimitSweep);

  // 1. Останавливаем приём новых апдейтов от Telegram. При вебхуке останавливать нечего
  //    (polling-цикла нет), а сам вебхук намеренно не снимаем — так Telegram доставит
  //    накопленные обновления после рестарта. Приём новых доставок прекратит server.close().
  if (!useWebhook) {
    try {
      await bot.stop();
      console.log('Бот остановлен');
    } catch (err) {
      console.error('Ошибка при остановке бота:', err);
    }
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
