/**
 * Dev login helper: mints a one-time login token and prints a ready-to-open
 * admin URL — no Telegram needed (the bot's /dashboard link can't target
 * localhost: Telegram rejects localhost links and WebApp buttons need HTTPS).
 *
 * Run with:
 *   npm run dev:login                     # first admin in the DB
 *   npm run dev:login -- @username        # specific admin by username
 *   npm run dev:login -- 123456789        # specific admin by telegram_id
 *
 * Base URL defaults to http://localhost:5173 (Vite dev server, proxies /api).
 * Override with DEV_LOGIN_URL, e.g. DEV_LOGIN_URL=http://localhost:3000.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, isNotNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import * as schema from '../src/db/schema.js';
import { users, loginTokens } from '../src/db/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Run with: tsx --env-file=.env scripts/dev-login.ts',
  );
  process.exit(1);
}

const BASE_URL = (process.env.DEV_LOGIN_URL ?? 'http://localhost:5173').replace(
  /\/$/,
  '',
);
const TTL_MS = 30 * 60 * 1000;

const db = drizzle(DATABASE_URL, { schema });

async function main(): Promise<void> {
  const arg = process.argv[2];

  let user;
  if (arg) {
    const handle = arg.replace(/^@/, '');
    user = arg.startsWith('@')
      ? await db.query.users.findFirst({
          where: and(eq(users.username, handle), isNotNull(users.telegram_id)),
        })
      : await db.query.users.findFirst({
          where: eq(users.telegram_id, handle),
        });
    if (!user) {
      console.error(`Пользователь "${arg}" не найден.`);
      process.exit(1);
    }
  } else {
    user = await db.query.users.findFirst({ where: eq(users.role, 'admin') });
    if (!user) {
      console.error(
        'В БД нет ни одного администратора. Назначь себя:\n' +
          "  psql ... -c \"UPDATE prod.users SET role='admin' WHERE telegram_id='<твой_id>';\"",
      );
      process.exit(1);
    }
  }

  if (user.role !== 'admin') {
    console.error(
      `Пользователь @${user.username} не админ (role=${user.role}). Вход в админку отклонится.`,
    );
    process.exit(1);
  }

  const token = randomBytes(16).toString('hex');
  await db.insert(loginTokens).values({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + TTL_MS),
  });

  const blue = '\x1b[34m';
  const reset = '\x1b[0m';
  console.log(`Вход как @${user.username} (${user.role}), ссылка на 30 минут:`);
  console.log(`  ${blue}${BASE_URL}/api/auth/token?t=${token}${reset}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
