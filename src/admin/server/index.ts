import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { bot } from '../../bot/instance.js';
import { createAuthRouter } from './auth.js';
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

  // Auth routes (no auth middleware)
  app.route('/api/auth', createAuthRouter());

  // Protected routes
  app.route('/api/tournaments', createTournamentsRouter(bot.api));
  app.route('/api/matches', createMatchesRouter(bot.api));
  app.route('/api/users', createUsersRouter());
  app.route('/api/tables', createTablesRouter());
  app.route('/api/venues', createVenuesRouter());

  return app;
}

export type AdminAppType = ReturnType<typeof createAdminServer>;
