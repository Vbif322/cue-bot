import { Hono } from "hono";
import { cors } from "hono/cors";
import { bot } from "../../bot/instance.js";
import { createAuthRouter } from "./auth.js";
import { createTournamentsRouter } from "./routes/tournaments.js";
import { createMatchesRouter } from "./routes/matches.js";
import { createUsersRouter } from "./routes/users.js";

export function createAdminServer() {
  const app = new Hono();

  // CORS for Vite dev server (dev only)
  if (process.env.NODE_ENV === "development") {
    app.use(
      "/api/*",
      cors({
        origin: "http://localhost:5173",
        credentials: true,
      }),
    );
  }

  // Health check
  app.get("/api/health", (c) => c.json({ ok: true }));

  // Auth routes (no auth middleware)
  app.route("/api/auth", createAuthRouter(bot.api));

  // Protected routes
  app.route("/api/tournaments", createTournamentsRouter(bot.api));
  app.route("/api/matches", createMatchesRouter(bot.api));
  app.route("/api/users", createUsersRouter());

  return app;
}

export type AdminAppType = ReturnType<typeof createAdminServer>;
