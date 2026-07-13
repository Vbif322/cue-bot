import type { UUID } from 'crypto';

import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import {
  users,
  userIdentities,
  tournamentReferees,
  matches,
  notifications,
} from '@/db/schema.js';
import { mergeAccountIntoTelegram, MergeError } from '@/services/userService.js';

import {
  createUser,
  createTournament,
  createConfirmedParticipant,
} from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

/** Telegram-аккаунт: строка users с telegram_id + telegram-identity. */
async function telegramAccount(
  tgId: string,
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const u = await createUser({
    telegram_id: tgId,
    username: `tg_${tgId}`,
    ...overrides,
  });
  await db
    .insert(userIdentities)
    .values({ userId: u.id, provider: 'telegram', providerId: tgId });
  return u;
}

/** Email-аккаунт: строка users без telegram_id + verified email-identity. */
async function emailAccount(
  email: string,
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const u = await createUser({
    email,
    username: email.split('@')[0] ?? email,
    ...overrides,
  });
  await db.insert(userIdentities).values({
    userId: u.id,
    provider: 'email',
    providerId: email,
    emailVerifiedAt: new Date(),
  });
  return u;
}

async function insertMatch(
  tournamentId: UUID,
  cols: Partial<typeof matches.$inferInsert>,
) {
  const [m] = await db
    .insert(matches)
    .values({ tournamentId, round: 1, position: 1, ...cols })
    .returning();
  if (!m) throw new Error('insert match returned no rows');
  return m;
}

async function identitiesOf(userId: UUID) {
  return db.query.userIdentities.findMany({
    where: (i, { eq }) => eq(i.userId, userId),
  });
}

async function userById(userId: UUID) {
  return db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId) });
}

/**
 * Страховка от дрейфа FK-графа: перечисляем из information_schema ВСЕ колонки,
 * ссылающиеся на prod.users(id), и проверяем, что после слияния ни одна строка
 * больше не указывает на `userId`. Если завтра добавят таблицу со ссылкой на
 * users.id, а перепривязку в mergeAccountIntoTelegram забудут — этот тест упадёт.
 */
async function expectNoReferences(userId: UUID) {
  const cols = await db.execute(sql`
    SELECT tc.table_name AS table_name, kcu.column_name AS column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'prod'
      AND ccu.table_name = 'users'
      AND ccu.column_name = 'id'
  `);
  const refs = cols.rows as { table_name: string; column_name: string }[];
  // Sanity: интроспекция должна что-то найти, иначе тест ничего не проверяет.
  expect(refs.length).toBeGreaterThan(0);

  for (const { table_name, column_name } of refs) {
    const r = await db.execute(
      sql.raw(
        `SELECT count(*)::int AS n FROM "prod"."${table_name}" WHERE "${column_name}" = '${userId}'`,
      ),
    );
    const n = (r.rows as { n: number }[])[0]?.n ?? 0;
    expect(
      n,
      `${table_name}.${column_name} всё ещё ссылается на слитый аккаунт`,
    ).toBe(0);
  }
}

describe('mergeAccountIntoTelegram', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('переносит историю на Telegram-аккаунт и тумбстонит email-аккаунт', async () => {
    const survivor = await telegramAccount('1001');
    const losing = await emailAccount('player@mail.com');

    // Наделяем email-аккаунт историей, которую нужно перепривязать.
    const t = await createTournament();
    await createConfirmedParticipant(t.id, { userId: losing.id, seed: 1 });
    await db
      .insert(tournamentReferees)
      .values({ tournamentId: t.id, userId: losing.id });
    const m = await insertMatch(t.id, {
      player1Id: losing.id,
      winnerId: losing.id,
      reportedBy: losing.id,
    });
    await db.insert(notifications).values({
      userId: losing.id,
      type: 'match_reminder',
      title: 'Напоминание',
      message: 'Матч',
    });

    const merged = await mergeAccountIntoTelegram(survivor.id, losing.id);

    // survivor остаётся, получает email-identity и email.
    expect(merged.id).toBe(survivor.id);
    expect(merged.email).toBe('player@mail.com');
    const survIdents = await identitiesOf(survivor.id);
    expect(survIdents.map((i) => i.provider).sort()).toEqual([
      'email',
      'telegram',
    ]);

    // losing тумбстонится и остаётся без identity.
    const loser = await userById(losing.id);
    expect(loser?.deletedAt).not.toBeNull();
    expect(loser?.telegram_id).toBeNull();
    expect(loser?.email).toBeNull();
    expect(await identitiesOf(losing.id)).toHaveLength(0);

    // История перепривязана на survivor.
    const part = await db.query.tournamentParticipants.findFirst({
      where: (p, { eq }) => eq(p.tournamentId, t.id),
    });
    expect(part?.userId).toBe(survivor.id);
    const ref = await db.query.tournamentReferees.findFirst({
      where: (rr, { eq }) => eq(rr.tournamentId, t.id),
    });
    expect(ref?.userId).toBe(survivor.id);
    const mm = await db.query.matches.findFirst({
      where: (x, { eq }) => eq(x.id, m.id),
    });
    expect(mm?.player1Id).toBe(survivor.id);
    expect(mm?.winnerId).toBe(survivor.id);
    expect(mm?.reportedBy).toBe(survivor.id);
    const notif = await db.query.notifications.findFirst({});
    expect(notif?.userId).toBe(survivor.id);

    await expectNoReferences(losing.id);
  });

  it('при участии обоих в одном турнире удаляет строку losing (композитный PK)', async () => {
    const survivor = await telegramAccount('2001');
    const losing = await emailAccount('dup@mail.com');
    const t = await createTournament();
    await createConfirmedParticipant(t.id, { userId: survivor.id, seed: 1 });
    await createConfirmedParticipant(t.id, { userId: losing.id, seed: 2 });

    await mergeAccountIntoTelegram(survivor.id, losing.id);

    const parts = await db.query.tournamentParticipants.findMany({
      where: (p, { eq }) => eq(p.tournamentId, t.id),
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]?.userId).toBe(survivor.id);
    await expectNoReferences(losing.id);
  });

  it('отказывает, если аккаунты играли друг против друга', async () => {
    const survivor = await telegramAccount('3001');
    const losing = await emailAccount('h2h@mail.com');
    const t = await createTournament();
    await insertMatch(t.id, {
      player1Id: survivor.id,
      player2Id: losing.id,
    });

    await expect(
      mergeAccountIntoTelegram(survivor.id, losing.id),
    ).rejects.toBeInstanceOf(MergeError);

    // Ничего не изменилось.
    const loser = await userById(losing.id);
    expect(loser?.deletedAt).toBeNull();
    expect(await identitiesOf(losing.id)).toHaveLength(1);
  });

  it('отказывает, если у survivor уже есть email-identity', async () => {
    const survivor = await telegramAccount('4001', {
      email: 'existing@mail.com',
    });
    await db.insert(userIdentities).values({
      userId: survivor.id,
      provider: 'email',
      providerId: 'existing@mail.com',
      emailVerifiedAt: new Date(),
    });
    const losing = await emailAccount('new@mail.com');

    await expect(
      mergeAccountIntoTelegram(survivor.id, losing.id),
    ).rejects.toBeInstanceOf(MergeError);

    const loser = await userById(losing.id);
    expect(loser?.deletedAt).toBeNull();
  });

  it('поднимает роль survivor до admin, если losing был админом', async () => {
    const survivor = await telegramAccount('5001');
    const losing = await emailAccount('adm@mail.com', { role: 'admin' });

    const merged = await mergeAccountIntoTelegram(survivor.id, losing.id);
    expect(merged.role).toBe('admin');
  });

  it('отказывается сливать аккаунт сам с собой', async () => {
    const u = await telegramAccount('6001');
    await expect(
      mergeAccountIntoTelegram(u.id, u.id),
    ).rejects.toBeInstanceOf(MergeError);
  });
});
