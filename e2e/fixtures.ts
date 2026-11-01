import type { UUID } from 'crypto';

import {
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { signAppToken, signToken } from '@/admin/server/middleware.js';
import { db } from '@/db/db.js';
import { tables } from '@/db/schema.js';

import {
  createAdminUser,
  createUser,
  createVenue,
} from '../test/helpers/factories.js';
import { truncateAll } from '../test/helpers/truncate.js';
import { ADMIN_URL, APP_URL } from './env.js';

export interface Session {
  context: BrowserContext;
  page: Page;
}

export interface Player extends Session {
  id: UUID;
  /** Display name as the player site renders it ("Имя Фамилия"). */
  name: string;
  /** The admin SPA's tables show only the first name. */
  firstName: string;
  /** Unique; the admin participants table shows it as "@username". */
  username: string;
}

export interface Admin extends Session {
  id: UUID;
}

export interface Venue {
  id: UUID;
  name: string;
  tableNames: string[];
}

/** Realistic, pairwise-distinct names so exact text/label matches stay unique. */
const PLAYER_NAMES: readonly [string, string, string][] = [
  ['Алексей', 'Иванов', 'a_ivanov'],
  ['Борис', 'Петров', 'b_petrov'],
  ['Виктор', 'Сидоров', 'v_sidorov'],
  ['Григорий', 'Кузнецов', 'g_kuznetsov'],
  ['Дмитрий', 'Смирнов', 'd_smirnov'],
  ['Евгений', 'Попов', 'e_popov'],
  ['Жанна', 'Волкова', 'zh_volkova'],
  ['Зоя', 'Морозова', 'z_morozova'],
  ['Игорь', 'Лебедев', 'i_lebedev'],
  ['Кирилл', 'Козлов', 'k_kozlov'],
  ['Лариса', 'Новикова', 'l_novikova'],
  ['Максим', 'Орлов', 'm_orlov'],
  ['Наталья', 'Соколова', 'n_sokolova'],
  ['Олег', 'Павлов', 'o_pavlov'],
  ['Полина', 'Федорова', 'p_fedorova'],
  ['Роман', 'Егоров', 'r_egorov'],
];

async function openSession(
  browser: Browser,
  baseURL: string,
  cookie: { name: string; value: string },
): Promise<Session> {
  const context = await browser.newContext({ baseURL });
  await context.addCookies([{ ...cookie, url: baseURL }]);
  const page = await context.newPage();
  return { context, page };
}

interface Fixtures {
  /** Auto: every test starts from an empty DB. */
  cleanDb: undefined;
  /** Seeded admin, logged into the admin SPA in its own browser context. */
  admin: Admin;
  /** Seeded web-only players (no telegram_id), each in an isolated context. */
  players: Player[];
  /** How many players the `players` fixture seeds. */
  playerCount: number;
  /** How many tables the `venue` fixture creates. */
  tableCount: number;
  /** Seeded venue with tables, so matches are called to real tables. */
  venue: Venue;
}

export const test = base.extend<Fixtures>({
  playerCount: [4, { option: true }],
  tableCount: [2, { option: true }],

  cleanDb: [
    // Playwright requires the destructuring pattern even with no dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await truncateAll();
      await use(undefined);
    },
    { auto: true },
  ],

  venue: async ({ tableCount }, use) => {
    const venue = await createVenue({ name: 'E2E Клуб' });
    const tableNames = Array.from(
      { length: tableCount },
      (_, i) => `Стол ${String(i + 1)}`,
    );
    await db
      .insert(tables)
      .values(tableNames.map((name) => ({ name, venueId: venue.id })));
    await use({ id: venue.id, name: venue.name, tableNames });
  },

  admin: async ({ browser }, use) => {
    const user = await createAdminUser({
      username: 'e2e_admin',
      name: 'Админ',
      surname: 'Турниров',
    });
    const session = await openSession(browser, ADMIN_URL, {
      name: 'admin_token',
      value: signToken({ id: user.id, username: user.username, role: 'admin' }),
    });
    await use({ id: user.id, ...session });
    await session.context.close();
  },

  players: async ({ browser, playerCount }, use) => {
    if (playerCount > PLAYER_NAMES.length) {
      throw new Error(`at most ${String(PLAYER_NAMES.length)} players`);
    }
    const players: Player[] = [];
    for (const [name, surname, username] of PLAYER_NAMES.slice(
      0,
      playerCount,
    )) {
      const user = await createUser({ name, surname, username });
      const session = await openSession(browser, APP_URL, {
        name: 'app_token',
        value: signAppToken(user.id),
      });
      players.push({
        id: user.id,
        name: `${name} ${surname}`,
        firstName: name,
        username,
        ...session,
      });
    }
    await use(players);
    await Promise.all(players.map((p) => p.context.close()));
  },
});

export { expect } from '@playwright/test';
