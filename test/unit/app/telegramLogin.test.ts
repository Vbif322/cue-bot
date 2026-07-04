import { describe, expect, it } from 'vitest';

import { verifyTelegramLogin } from '@/app/server/telegramLogin.js';

import { signTelegramPayload } from '../../helpers/telegram.js';

const TOKEN = 'test-token';
// Фиксированная «точка отсчёта» — auth_date и nowMs задаём явно, без Date.now(),
// чтобы тесты были детерминированными.
const AUTH_DATE = 1_700_000_000;
const NOW_MS = (AUTH_DATE + 10) * 1000; // +10с от auth_date — внутри окна 5 мин

function validPayload(overrides: Record<string, unknown> = {}) {
  return signTelegramPayload(
    {
      id: 987654,
      first_name: 'Иван',
      last_name: 'Петров',
      username: 'ivan',
      photo_url: 'https://t.me/i/userpic/320/ivan.jpg',
      auth_date: AUTH_DATE,
      ...overrides,
    },
    TOKEN,
  );
}

describe('verifyTelegramLogin', () => {
  it('принимает валидный payload и нормализует поля', () => {
    const result = verifyTelegramLogin(validPayload(), TOKEN, NOW_MS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      id: '987654',
      firstName: 'Иван',
      lastName: 'Петров',
      username: 'ivan',
      photoUrl: 'https://t.me/i/userpic/320/ivan.jpg',
    });
  });

  it('принимает минимальный payload (только обязательные поля)', () => {
    const payload = signTelegramPayload(
      { id: 42, first_name: 'A', auth_date: AUTH_DATE },
      TOKEN,
    );
    const result = verifyTelegramLogin(payload, TOKEN, NOW_MS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ id: '42', firstName: 'A' });
  });

  it('отклоняет подделанный hash', () => {
    const payload = { ...validPayload(), hash: 'deadbeef'.repeat(8) };
    const result = verifyTelegramLogin(payload, TOKEN, NOW_MS);

    expect(result.ok).toBe(false);
  });

  it('отклоняет payload, подписанный другим токеном', () => {
    const payload = validPayload();
    const result = verifyTelegramLogin(payload, 'другой-токен', NOW_MS);

    expect(result.ok).toBe(false);
  });

  it('отклоняет просроченный auth_date (старше 5 минут)', () => {
    const payload = validPayload();
    const staleNow = (AUTH_DATE + 6 * 60) * 1000; // +6 минут
    const result = verifyTelegramLogin(payload, TOKEN, staleNow);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('Ссылка устарела');
  });

  it('отклоняет auth_date из далёкого будущего', () => {
    const payload = validPayload();
    const pastNow = (AUTH_DATE - 5 * 60) * 1000; // now на 5 минут раньше auth_date
    const result = verifyTelegramLogin(payload, TOKEN, pastNow);

    expect(result.ok).toBe(false);
  });

  it('отклоняет payload с отсутствующими обязательными полями', () => {
    for (const missing of ['id', 'first_name', 'auth_date', 'hash']) {
      const payload = Object.fromEntries(
        Object.entries(validPayload()).filter(([key]) => key !== missing),
      );
      const result = verifyTelegramLogin(payload, TOKEN, NOW_MS);
      expect(result.ok, `поле ${missing}`).toBe(false);
    }
  });

  it('отклоняет не-объект', () => {
    expect(verifyTelegramLogin(null, TOKEN, NOW_MS).ok).toBe(false);
    expect(verifyTelegramLogin('строка', TOKEN, NOW_MS).ok).toBe(false);
  });
});
