import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { webhookCallback } from 'grammy';
import { bot, useWebhook } from '../../bot/instance.js';
import { createAuthRouter } from './auth.js';
import { createAppAuthRouter } from '../../app/server/routes/auth.js';
import { createAppTournamentsRouter } from '../../app/server/routes/tournaments.js';
import { createAppMatchesRouter } from '../../app/server/routes/matches.js';
import { createAppMeRouter } from '../../app/server/routes/me.js';
import { createAppNotificationsRouter } from '../../app/server/routes/notifications.js';
import { createTournamentsRouter } from './routes/tournaments.js';
import { createMatchesRouter } from './routes/matches.js';
import { createUsersRouter } from './routes/users.js';
import { createTablesRouter } from './routes/tables.js';
import { createVenuesRouter } from './routes/venues.js';

export function createAdminServer() {
  const app = new Hono();

  // Security headers (defaults: X-Frame-Options, nosniff, HSTS, Referrer-Policy, …)
  // на все ответы, включая статику SPA. Без CSP, чтобы не ломать React-приложение.
  // COOP оставляем дефолтным: вход через Telegram теперь редиректный (OIDC), попап
  // oauth.telegram.org и window.opener больше не задействованы.
  app.use('*', secureHeaders());

  // CORS for Vite dev server (dev only)
  if (process.env.NODE_ENV === 'development') {
    app.use(
      '/api/*',
      cors({
        origin: ['http://localhost:5173', 'http://localhost:5174'],
        credentials: true,
      }),
    );
  }

  // Health check
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Telegram webhook — монтируется ТОЛЬКО в webhook-режиме (useWebhook). Иначе grammY
  // `webhookCallback` подменяет `bot.start` заглушкой, и polling-ветка в index.ts падает
  // с «You already started the bot via webhooks». Секрет вшит в путь И проверяется grammY
  // по заголовку X-Telegram-Bot-Api-Secret-Token (secretToken, авто-401 при несовпадении).
  // Регистрируется здесь, чтобы предшествовать serveStatic('/*'), который index.ts добавляет
  // после этой фабрики (Hono матчит в порядке регистрации).
  if (useWebhook) {
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (webhookSecret) {
      app.post(
        `/api/telegram/webhook/${webhookSecret}`,
        webhookCallback(bot, 'hono', { secretToken: webhookSecret }),
      );
    } else {
      console.warn(
        'TELEGRAM_WEBHOOK_SECRET не задан — вебхук не смонтирован, бот не будет получать обновления.',
      );
    }
  }

  // Auth routes (no auth middleware)
  app.route('/api/auth', createAuthRouter());

  // Публичный конфиг для SPA игрока: включён ли вход через Telegram. Кнопка входа —
  // просто ссылка на /api/app/auth/telegram/start (OIDC-редирект), username бота ей не
  // нужен; достаточно знать, сконфигурирован ли OIDC-клиент (TELEGRAM_CLIENT_ID).
  // Статичное значение из env — без rate-limit.
  app.get('/api/app/config', (c) =>
    c.json({
      data: { telegramLoginEnabled: Boolean(process.env.TELEGRAM_CLIENT_ID) },
    }),
  );

  // Беспарольный вход игрока (код на почту + Telegram-виджет) — общий бэкенд для
  // SPA app/ (Этапы 3, 7).
  app.route('/api/app/auth', createAppAuthRouter());

  // REST API игрока для SPA app/ (Этап 4). Каждый роутер сам вешает requireUser
  // (кроме публичных GET-ов ленты/карточки внутри tournaments).
  app.route('/api/app/tournaments', createAppTournamentsRouter());
  app.route('/api/app/matches', createAppMatchesRouter(bot.api));
  app.route('/api/app/me', createAppMeRouter());
  app.route('/api/app/notifications', createAppNotificationsRouter());

  // Protected routes
  app.route('/api/tournaments', createTournamentsRouter(bot.api));
  app.route('/api/matches', createMatchesRouter(bot.api));
  app.route('/api/users', createUsersRouter());
  app.route('/api/tables', createTablesRouter());
  app.route('/api/venues', createVenuesRouter());

  return app;
}

export type AdminAppType = ReturnType<typeof createAdminServer>;
