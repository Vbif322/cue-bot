import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPkce,
  createState,
  buildAuthUrl,
  verifyIdToken,
  redirectUri,
} from '@/app/server/telegramOidc.js';

const CLIENT_ID = 'test-client';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Собирает неподписанный id_token (verifyIdToken подпись не проверяет). */
function idToken(claims: Record<string, unknown>): string {
  return `${b64url({ alg: 'none' })}.${b64url(claims)}.sig`;
}

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: 'https://oauth.telegram.org',
    aud: CLIENT_ID,
    exp: 2_000_000_000,
    sub: '12345',
    name: 'Иван',
    ...overrides,
  };
}

const NOW_MS = 1_000_000_000 * 1000; // задолго до exp=2e9

beforeEach(() => {
  process.env.TELEGRAM_CLIENT_ID = CLIENT_ID;
});

describe('createPkce', () => {
  it('challenge = base64url(SHA256(verifier))', () => {
    const { codeVerifier, codeChallenge } = createPkce();
    const expected = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    expect(codeChallenge).toBe(expected);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/); // base64url без паддинга
  });

  it('createState выдаёт случайные непустые значения', () => {
    expect(createState()).not.toBe(createState());
    expect(createState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('buildAuthUrl', () => {
  it('содержит обязательные OIDC-параметры', () => {
    const url = new URL(
      buildAuthUrl({
        state: 'st',
        codeChallenge: 'ch',
        redirectUri: 'https://x/cb',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://oauth.telegram.org/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('code_challenge')).toBe('ch');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('redirect_uri')).toBe('https://x/cb');
  });

  it('бросает, если TELEGRAM_CLIENT_ID не задан', () => {
    delete process.env.TELEGRAM_CLIENT_ID;
    expect(() =>
      buildAuthUrl({ state: 's', codeChallenge: 'c', redirectUri: 'https://x/cb' }),
    ).toThrow();
  });
});

describe('verifyIdToken', () => {
  it('валидный токен → нормализованные claim-ы', () => {
    const res = verifyIdToken(
      idToken(
        validClaims({
          preferred_username: 'ivan',
          picture: 'https://p/1.jpg',
        }),
      ),
      NOW_MS,
    );
    expect(res).toEqual({
      ok: true,
      data: {
        id: '12345',
        firstName: 'Иван',
        username: 'ivan',
        photoUrl: 'https://p/1.jpg',
      },
    });
  });

  it('firstName падает на preferred_username, затем на id', () => {
    const noName = verifyIdToken(
      idToken(validClaims({ name: undefined, preferred_username: 'nick' })),
      NOW_MS,
    );
    expect(noName.ok && noName.data.firstName).toBe('nick');

    const bare = verifyIdToken(
      idToken(validClaims({ name: undefined })),
      NOW_MS,
    );
    expect(bare.ok && bare.data.firstName).toBe('12345');
  });

  it('чужой iss → отказ', () => {
    const res = verifyIdToken(
      idToken(validClaims({ iss: 'https://evil' })),
      NOW_MS,
    );
    expect(res.ok).toBe(false);
  });

  it('чужой aud → отказ', () => {
    const res = verifyIdToken(idToken(validClaims({ aud: 'other' })), NOW_MS);
    expect(res.ok).toBe(false);
  });

  it('aud-массив с нашим client_id → успех', () => {
    const res = verifyIdToken(
      idToken(validClaims({ aud: ['other', CLIENT_ID] })),
      NOW_MS,
    );
    expect(res.ok).toBe(true);
  });

  it('истёкший exp → отказ', () => {
    const res = verifyIdToken(idToken(validClaims({ exp: 100 })), NOW_MS);
    expect(res.ok).toBe(false);
  });

  it('нет sub → отказ', () => {
    const res = verifyIdToken(idToken(validClaims({ sub: undefined })), NOW_MS);
    expect(res.ok).toBe(false);
  });

  it('битый JWT → отказ', () => {
    expect(verifyIdToken('не.jwt', NOW_MS).ok).toBe(false);
    expect(verifyIdToken('a.b', NOW_MS).ok).toBe(false);
  });
});

describe('redirectUri', () => {
  const saved = {
    r: process.env.TELEGRAM_REDIRECT_URI,
    p: process.env.PUBLIC_BASE_URL,
  };
  afterEach(() => {
    if (saved.r === undefined) delete process.env.TELEGRAM_REDIRECT_URI;
    else process.env.TELEGRAM_REDIRECT_URI = saved.r;
    if (saved.p === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = saved.p;
  });

  it('явный TELEGRAM_REDIRECT_URI имеет приоритет', () => {
    process.env.TELEGRAM_REDIRECT_URI = 'https://a/cb';
    process.env.PUBLIC_BASE_URL = 'https://b';
    expect(redirectUri()).toBe('https://a/cb');
  });

  it('иначе строится из PUBLIC_BASE_URL (без хвостового /)', () => {
    delete process.env.TELEGRAM_REDIRECT_URI;
    process.env.PUBLIC_BASE_URL = 'https://b/';
    expect(redirectUri()).toBe('https://b/api/app/auth/telegram/callback');
  });

  it('бросает, если ничего не задано', () => {
    delete process.env.TELEGRAM_REDIRECT_URI;
    delete process.env.PUBLIC_BASE_URL;
    expect(() => redirectUri()).toThrow();
  });
});
