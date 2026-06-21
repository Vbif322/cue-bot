# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Telegram bot for running billiards tournaments: player registration, bracket generation
(single/double elimination, round-robin), match scheduling, two-phase result confirmation,
and Telegram notifications. Ships with a web admin SPA. **All user-facing strings are in
Russian; there is no i18n framework — hardcode Russian to match.**

## Commands

```bash
# Dev
npm run dev:all        # Postgres (docker) + bot/API + admin Vite + Drizzle Studio, concurrently
npm run dev            # bot + Hono API only (nodemon, :3000)
npm run dev:admin      # admin Vite SPA only (:5173, proxies /api -> :3000)

# DB (Drizzle + Postgres in a docker container named `drizzle-postgres`)
npm run db:up          # start container; db:down to stop  (use *:wsl variants under WSL)
npm run db:generate    # generate migration from schema changes
npm run db:migrate     # apply migrations
npm run db:studio      # Drizzle Studio

# Quality
npm run lint           # eslint (lint:fix to autofix); npm run format = prettier --write .

# Tests (Vitest)
npm test               # unit + integration
npm run test:unit
npm run test:integration               # spins up a throwaway Postgres via testcontainers (needs docker)
npm run test:unit -- test/unit/services/foo.test.ts   # single file
npm run test:coverage
```

Build / run:

```bash
npm run build          # tsc (tsconfig.build.json) + tsc-alias -> build/
npm run build:admin    # build admin SPA -> admin/dist/
npm start              # node build/index.js (serves admin/dist when NODE_ENV=production)
```

Requires `.env` (see `.env.example`): `BOT_TOKEN`, `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PORT`, `NODE_ENV`.

## Architecture

Single Node process (`src/index.ts`) runs **both** the grammY bot (long-polling) and the Hono
HTTP server on `ADMIN_PORT` (default 3000). In production Hono also serves the built admin SPA
from `admin/dist`.

Request flow (bot): `bot/middleware` → handler `Composer`s → `services/*` → `db`.

- **bot/middleware** (`src/bot/middleware/`): `authMiddleware` looks up/creates the user by
  Telegram id and sets `ctx.dbUser` (relied on everywhere; see custom `BotContext` in
  `src/bot/types.ts`). `wizardGuardMiddleware` blocks unrelated commands while a wizard is active.
- **handlers** (`src/bot/handlers/*.ts`): each file exports a grammY `Composer<BotContext>`; all are
  registered in order via `bot.use(...)` in `src/index.ts`. Callback queries are matched by regex.
  Keep handlers thin — delegate to services.
- **services** (`src/services/*.ts`): all business logic and DB mutations live here, shared by both
  the bot and the admin API. Key ones: `bracketGenerator.ts` (single/double-elim/round-robin
  generation, byes/walkovers), `tournamentStartService.ts` (orchestrates seed → bracket → match
  rows → in_progress → notify), `matchService.ts` (report/confirm/dispute/technical + correction
  cascade through downstream matches), `randomBracketAdvancement.ts` (race-safe random advancement
  for `double_elimination_random`).
- **ui** (`src/bot/ui/*.ts`): pure functions building message text + grammY keyboards from data.

### Wizards
Multi-step bot flows live in `src/bot/wizards/`. The tournament-creation wizard is the template:
`tournamentCreation/` splits into `.module` (bootstrap + `registerWizard`), `.stateStore`
(in-memory `Map<userId, state>` — **sessions are lost on restart**), `.flow` (step state machine),
`.renderer`, `.keyboards`, `.const`, `.d.ts`. All wizard callbacks use a prefix (`tc:`) so
`wizardGuard` recognizes them; wizards register in `src/bot/wizards/wizardRegistry.ts`.

### Admin web API + auth bridge
`src/admin/server/` is the Hono app (`index.ts` = `createAdminServer()`), routes under
`routes/`, all protected by `requireAdmin` (`middleware.ts`) which validates the JWT cookie **and
re-checks the user's role in the DB on every request**. Login bridges Telegram → web:
`POST /api/auth/request-code` sends a 6-digit code (`loginCodes` table) through the bot, and
`POST /api/auth/verify-code` issues a JWT in an HttpOnly `admin_token` cookie. The bot's
`/dashboard` command instead issues a one-click `loginTokens` link.

The admin SPA (`admin/`) is a **separate Vite/React project with its own package.json**. It calls
`/api/*` with `credentials: include` (client in `admin/src/lib/api.ts`). API read-model types live
in `src/bot/@types/*.d.ts`, re-exported by `src/admin/server/apiTypes.ts` and shared with the SPA
via the `@server/*` alias.

### Database
Drizzle ORM over Postgres. Per-entity table definitions in `src/db/schema/*.ts`, re-exported by
`src/db/schema.ts`. Non-obvious bits: all tables live in a **`prod` Postgres schema**
(`prodSchema` in `src/db/schemaHelpers.ts`); `src/db/db.ts` throws at import if `DATABASE_URL`
is unset; the `matches` row carries the bracket routing (`nextMatchId`/`nextMatchPosition`,
walkover/technical flags) that drives advancement; the `tournament*` junctions use composite PKs.
Change schema → `npm run db:generate` → `npm run db:migrate`.

## Conventions
- ESM + `@/*` path alias → `src/*` (resolved by `tsc-alias` at build, by `vitest.config.ts` in
  tests). NodeNext imports use `.js` specifiers pointing at `.ts` sources.
- Two tsconfigs: `tsconfig.json` is editor/typecheck only (`noEmit`, includes `test/`);
  `tsconfig.build.json` is the emitting build (`rootDir: src`).
- Strict TS incl. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. ESLint uses
  `eslint-config-love`.
- **Error conventions** (intentionally split, not unified): services with user-facing outcomes
  (`matchService`) return `{ success, error }` result objects; `canStartTournament` returns
  `{ canStart, error }`; `tournamentService` throws `Error` for invalid states. Callers (bot
  handlers, admin routes) that catch an exception **must** surface `errorMessage(e)`
  (`src/utils/errors.ts`) — never `JSON.stringify(error)`, which serialises an `Error` to `"{}"`.
- **Unit tests must not hit the DB.** `test/setup/unit.setup.ts` sets a dummy `DATABASE_URL`
  (and `JWT_SECRET`) only so modules that import `db` at top level load cleanly; the pool is lazy,
  so a unit test that actually issues a query will hang/timeout **by design**, surfacing a
  mis-scoped test. Anything that queries belongs in the `integration` project (testcontainers
  Postgres, requires docker).

## Reference docs
`README.md` (setup/run, in Russian), `TECHNICAL_DOCUMENTATION.md` (architecture/schema/API),
`BUSINESS_REQUIREMENTS.md` (domain/user stories), `TODO.md`, `CHANGELOG.md`.
