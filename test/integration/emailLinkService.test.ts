import type { UUID } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { userIdentities, users } from '@/db/schema.js';
import {
  confirmEmailLink,
  getVerifiedEmail,
  requestEmailLinkCode,
} from '@/services/emailLinkService.js';

import { createUser } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

// Plaintext-код только уходит в письмо (в БД sha256) — перехватываем из мока.
vi.mock('@/services/mailService.js', () => ({
  sendLoginCodeEmail: vi.fn().mockResolvedValue(undefined),
}));
import { sendLoginCodeEmail } from '@/services/mailService.js';
const mockedSend = vi.mocked(sendLoginCodeEmail);

// Лимитеры — модульные синглтоны, truncateAll их не сбрасывает: уникальные адрес и
// пользователь на кейс исключают взаимное влияние.
let seq = 0;
const nextEmail = (): string => `svc${String(seq++)}@example.com`;
let tg = 9000;
const tgUser = () =>
  createUser({ telegram_id: String(tg), username: `tg${String(tg++)}` });

async function requestCode(userId: UUID, email: string): Promise<string> {
  mockedSend.mockClear();
  const res = await requestEmailLinkCode(userId, email);
  expect(res.success).toBe(true);
  const call = mockedSend.mock.calls.at(-1);
  if (!call) throw new Error('sendLoginCodeEmail не был вызван');
  expect(call[2]).toBe('link');
  return call[1];
}

describe('emailLinkService — привязка почты к существующему аккаунту', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('привязывает почту: нормализует адрес, пишет identity и users.email', async () => {
    const user = await tgUser();
    const email = nextEmail();
    const code = await requestCode(user.id, `  ${email.toUpperCase()} `);

    const res = await confirmEmailLink(user.id, email.toUpperCase(), code);
    expect(res).toEqual({ success: true, email });

    expect(await getVerifiedEmail(user.id)).toBe(email);
    const fresh = await db.query.users.findFirst({
      where: eq(users.id, user.id),
    });
    expect(fresh?.email).toBe(email);
  });

  it('отклоняет некорректный адрес без отправки письма', async () => {
    const user = await tgUser();
    mockedSend.mockClear();
    const res = await requestEmailLinkCode(user.id, 'not-an-email');
    expect(res).toMatchObject({ success: false, reason: 'invalid_email' });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('почта другого аккаунта → exists, письмо не шлётся', async () => {
    const other = await createUser();
    const email = nextEmail();
    await db.insert(userIdentities).values({
      userId: other.id,
      provider: 'email',
      providerId: email,
      emailVerifiedAt: new Date(),
    });
    const user = await tgUser();
    mockedSend.mockClear();

    const res = await requestEmailLinkCode(user.id, email);
    expect(res).toMatchObject({ success: false, reason: 'exists' });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('своя почта уже есть → already_linked / has_other', async () => {
    const user = await tgUser();
    const email = nextEmail();
    await db.insert(userIdentities).values({
      userId: user.id,
      provider: 'email',
      providerId: email,
      emailVerifiedAt: new Date(),
    });

    expect(await requestEmailLinkCode(user.id, email)).toMatchObject({
      reason: 'already_linked',
    });
    expect(await requestEmailLinkCode(user.id, nextEmail())).toMatchObject({
      reason: 'has_other',
    });
  });

  it('неверный код → invalid_code, identity не создаётся', async () => {
    const user = await tgUser();
    const email = nextEmail();
    const code = await requestCode(user.id, email);
    const wrong = code === '000000' ? '111111' : '000000';

    expect(await confirmEmailLink(user.id, email, wrong)).toMatchObject({
      success: false,
      reason: 'invalid_code',
    });
    expect(await confirmEmailLink(user.id, email, 'abc')).toMatchObject({
      reason: 'invalid_code',
    });
    expect(await getVerifiedEmail(user.id)).toBeNull();
  });

  it('пер-юзер лимит: 6-й запрос подряд → rate_limited', async () => {
    const user = await tgUser();
    for (let i = 0; i < 5; i++) {
      expect((await requestEmailLinkCode(user.id, nextEmail())).success).toBe(
        true,
      );
    }
    expect(await requestEmailLinkCode(user.id, nextEmail())).toMatchObject({
      success: false,
      reason: 'rate_limited',
    });
  });

  it('почту забрали между запросом кода и подтверждением → exists', async () => {
    const user = await tgUser();
    const email = nextEmail();
    const code = await requestCode(user.id, email);

    const other = await createUser();
    await db.insert(userIdentities).values({
      userId: other.id,
      provider: 'email',
      providerId: email,
      emailVerifiedAt: new Date(),
    });

    expect(await confirmEmailLink(user.id, email, code)).toMatchObject({
      success: false,
      reason: 'exists',
    });
    expect(await getVerifiedEmail(user.id)).toBeNull();
  });
});
