import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { webhookCallback } from 'grammy';
import { bot } from '../../bot/instance.js';
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
  app.use('*', secureHeaders());

  // CORS for Vite dev server (dev only)
  if (process.env.NODE_ENV === 'development') {
    app.use(
      '/api/*',
      cors({
        origin: 'http://localhost:5173',
        credentials: true,
      }),
    );
  }

  // Health check
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Telegram webhook (production). The secret is embedded in the path AND verified
  // against the X-Telegram-Bot-Api-Secret-Token header by grammY (secretToken), which
  // auto-replies 401 on mismatch. Registered here so it precedes the serveStatic('/*')
  // catch-all that index.ts adds after this factory returns (Hono matches in order).
  // When TELEGRAM_WEBHOOK_SECRET is unset (dev/polling), the route simply isn't mounted.
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    app.post(
      `/api/telegram/webhook/${webhookSecret}`,
      webhookCallback(bot, 'hono', { secretToken: webhookSecret }),
    );
  } else if (process.env.NODE_ENV === 'production') {
    console.warn(
      'TELEGRAM_WEBHOOK_SECRET не задан — вебхук не смонтирован, бот не будет получать обновления.',
    );
  }

  // Auth routes (no auth middleware)
  app.route('/api/auth', createAuthRouter());

  // Беспарольный вход игрока (код на почту) — общий бэкенд для SPA app/ (Этап 3).
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
