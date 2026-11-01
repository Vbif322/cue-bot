/**
 * Dev helper: creates (idempotently) a guest organizer user with an active
 * organizer grant and a federation they own, then prints a one-time admin
 * login URL — same mechanism as scripts/dev-login.ts.
 *
 * Run with:
 *   npm run dev:organizer
 *
 * Base URL defaults to http://localhost:5173; override with DEV_LOGIN_URL.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import * as schema from '../src/db/schema.js';
import {
  users,
  loginTokens,
  federations,
  federationMembers,
} from '../src/db/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Run with: tsx --env-file=.env scripts/dev-organizer.ts',
  );
  process.exit(1);
}

const BASE_URL = (process.env.DEV_LOGIN_URL ?? 'http://localhost:5173').replace(
  /\/$/,
  '',
);
const TTL_MS = 30 * 60 * 1000;
const USERNAME = 'dev_organizer';
const FEDERATION_NAME = 'Dev Federation';

const db = drizzle(DATABASE_URL, { schema });

async function main(): Promise<void> {
  const grantUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  let user = await db.query.users.findFirst({
    where: and(eq(users.username, USERNAME), isNull(users.telegram_id)),
  });
  if (user) {
    [user] = await db
      .update(users)
      .set({ organizerUntil: grantUntil, deletedAt: null })
      .where(eq(users.id, user.id))
      .returning();
  } else {
    [user] = await db
      .insert(users)
      .values({
        username: USERNAME,
        name: 'Dev',
        surname: 'Organizer',
        role: 'user',
        organizerUntil: grantUntil,
      })
      .returning();
  }
  if (!user) throw new Error('Не удалось создать пользователя');

  const membership = await db.query.federationMembers.findFirst({
    where: eq(federationMembers.userId, user.id),
  });
  if (!membership) {
    const [federation] = await db
      .insert(federations)
      .values({ name: FEDERATION_NAME, city: 'Москва', createdBy: user.id })
      .returning();
    if (!federation) throw new Error('Не удалось создать федерацию');
    await db.insert(federationMembers).values({
      federationId: federation.id,
      userId: user.id,
      role: 'owner',
    });
  }

  const token = randomBytes(16).toString('hex');
  await db.insert(loginTokens).values({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + TTL_MS),
  });

  const blue = '\x1b[34m';
  const reset = '\x1b[0m';
  console.log(`Вход как @${user.username} (организатор), ссылка на 30 минут:`);
  console.log(`  ${blue}${BASE_URL}/api/auth/token?t=${token}${reset}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
