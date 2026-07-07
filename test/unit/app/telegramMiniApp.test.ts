import { describe, expect, it } from 'vitest';

import {
  buildMiniAppInitData,
  testMiniAppPublicKeyHex,
} from '../../helpers/telegramMiniApp.js';
import { verifyMiniAppInitData } from '@/app/server/telegramMiniApp.js';

// Верификатор должен доверять нашей тестовой паре, а не продовому ключу Telegram.
// Ставим ДО первого вызова verify (ключ читается лениво и кэшируется на первом вызове).
process.env.TELEGRAM_MINIAPP_PUBLIC_KEY = testMiniAppPublicKeyHex;

const BOT_ID = '123456';
const NOW = 1_700_000_000; // сек
const NOW_MS = NOW * 1000;

function user(overrides: Record<string, unknown> = {}) {
  return { id: 42, first_name: 'Иван', ...overrides };
}

describe('verifyMiniAppInitData', () => {
  it('валидная подпись → нормализованные claim-ы', () => {
    const initData = buildMiniAppInitData({
      botId: BOT_ID,
      authDate: NOW,
      user: user({
        last_name: 'Петров',
        username: 'ivan',
        photo_url: 'https://p/1.jpg',
      }),
      extra: { query_id: 'AAA' },
    });

    const res = verifyMiniAppInitData(initData, BOT_ID, NOW_MS);
    expect(res).toEqual({
      ok: true,
      data: {
        id: '42',
        firstName: 'Иван',
        username: 'ivan',
        surname: 'Петров',
        photoUrl: 'https://p/1.jpg',
      },
    });
  });

  it('минимальный user (только id + first_name) проходит', () => {
    const initData = buildMiniAppInitData({ botId: BOT_ID, authDate: NOW, user: user() });
    const res = verifyMiniAppInitData(initData, BOT_ID, NOW_MS);
    expect(res.ok && res.data).toEqual({ id: '42', firstName: 'Иван' });
  });

  it('подмена подписи → отказ', () => {
    const initData = buildMiniAppInitData({
      botId: BOT_ID,
      authDate: NOW,
      user: user(),
      tamperSignature: true,
    });
    expect(verifyMiniAppInitData(initData, BOT_ID, NOW_MS).ok).toBe(false);
  });

  it('другой bot_id → подпись не сходится', () => {
    const initData = buildMiniAppInitData({ botId: BOT_ID, authDate: NOW, user: user() });
    expect(verifyMiniAppInitData(initData, '999', NOW_MS).ok).toBe(false);
  });

  it('протухший auth_date → отказ', () => {
    const initData = buildMiniAppInitData({
      botId: BOT_ID,
      authDate: NOW - 2 * 60 * 60, // старше часа (MAX_AUTH_AGE_SEC)
      user: user(),
    });
    expect(verifyMiniAppInitData(initData, BOT_ID, NOW_MS).ok).toBe(false);
  });

  it('auth_date в пределах часа → проходит', () => {
    const initData = buildMiniAppInitData({
      botId: BOT_ID,
      authDate: NOW - 30 * 60,
      user: user(),
    });
    expect(verifyMiniAppInitData(initData, BOT_ID, NOW_MS).ok).toBe(true);
  });

  it('нет signature → отказ', () => {
    expect(verifyMiniAppInitData('user=%7B%7D&auth_date=1', BOT_ID, NOW_MS).ok).toBe(
      false,
    );
  });

  it('нет user → отказ', () => {
    const initData = buildMiniAppInitData({ botId: BOT_ID, authDate: NOW, user: user() });
    const params = new URLSearchParams(initData);
    params.delete('user');
    // подпись теперь не совпадёт (user входил в data_check_string) — это и есть отказ
    expect(verifyMiniAppInitData(params.toString(), BOT_ID, NOW_MS).ok).toBe(false);
  });
});
