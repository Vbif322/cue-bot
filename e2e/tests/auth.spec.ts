import { and, eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities, users } from '@/db/schema.js';

import { createAdminUser } from '../../test/helpers/factories.js';
import { ADMIN_URL, APP_URL } from '../env.js';
import { expect, test } from '../fixtures.js';
import { waitForLoginCode } from '../helpers/loginCode.js';

/*
 * The real email-code login, end to end. Tournament specs skip it and get
 * signed cookies instead: the API rate-limits code requests per IP.
 */

test('игрок входит на сайт по коду из письма', async ({ browser }) => {
  const email = 'new.player@example.com';
  const context = await browser.newContext({ baseURL: APP_URL });
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Получить код' }).click();
  await page.getByPlaceholder('000000').fill(await waitForLoginCode(email));
  await page.getByRole('button', { name: 'Войти' }).click();

  // First login creates the account; the email's local part is the username.
  await expect(page.getByText('@new.player').first()).toBeVisible();
  await page.goto('/matches');
  await expect(page.getByText('Матчей пока нет')).toBeVisible();

  const user = await db.query.users.findFirst({
    where: eq(users.username, 'new.player'),
  });
  expect(user?.telegram_id).toBeNull();
  const identity = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.provider, 'email'),
      eq(userIdentities.providerId, email),
    ),
  });
  expect(identity?.emailVerifiedAt).not.toBeNull();

  await context.close();
});

test('админ входит в панель по коду из письма', async ({ browser }) => {
  const email = 'organizer@example.com';
  const admin = await createAdminUser({ username: 'organizer' });
  await db.insert(userIdentities).values({
    userId: admin.id,
    provider: 'email',
    providerId: email,
    emailVerifiedAt: new Date(),
  });

  const context = await browser.newContext({ baseURL: ADMIN_URL });
  const page = await context.newPage();

  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Получить код' }).click();
  await page.getByPlaceholder('000000').fill(await waitForLoginCode(email));
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByRole('heading', { name: 'Турниры' })).toBeVisible();
  await expect(page.getByText('@organizer')).toBeVisible();

  await context.close();
});
