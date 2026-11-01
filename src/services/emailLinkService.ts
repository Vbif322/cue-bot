import type { UUID } from 'crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db/db.js';
import { userIdentities } from '@/db/schema.js';
import { RateLimiter } from '@/lib/rateLimiter.js';
import {
  generateLoginCode,
  hashCode,
  normalizeEmail,
} from '@/app/server/authCrypto.js';
import {
  emailCodeLimiter,
  issueLoginCode,
  verifyLoginCode,
} from './emailLoginCodeService.js';
import { sendLoginCodeEmail } from './mailService.js';
import { linkEmailToUser } from './userService.js';

/**
 * Привязка почты к УЖЕ существующему аккаунту (обычно Telegram-only) — общий код
 * для сайта игрока (`/api/app/auth/email/*`) и бота (профиль → «Привязать почту»).
 * Два шага: {@link requestEmailLinkCode} шлёт код на адрес, {@link confirmEmailLink}
 * проверяет его и записывает подтверждённую email-identity на этого пользователя.
 * Коды общие со входом (`email_login_codes`): владение ящиком доказывает любой из них.
 */

/**
 * Пер-юзер лимит запросов кода привязки (5 / час). Пер-email лимит не спасает от
 * рассылки писем по множеству чужих адресов с одного аккаунта (в боте нет пер-IP
 * анти-флуда). Очищается периодически в index.ts.
 */
export const emailLinkUserLimiter = new RateLimiter({
  capacity: 5,
  refillPerSec: 5 / (60 * 60),
});

/** Причина отказа — для вызывающих, которым нужна своя реакция (подсказка в боте). */
export type EmailLinkFailure =
  | 'invalid_email'
  | 'invalid_code'
  | 'already_linked'
  | 'has_other'
  | 'exists'
  | 'rate_limited'
  | 'failed';

export type EmailLinkResult =
  | { success: true; email: string }
  | { success: false; reason: EmailLinkFailure; error: string };

const ERRORS: Record<EmailLinkFailure, string> = {
  invalid_email: 'Некорректный email',
  invalid_code: 'Неверный или просроченный код',
  already_linked: 'Эта почта уже привязана.',
  has_other: 'К аккаунту уже привязана другая почта.',
  exists: 'Эта почта уже используется другим аккаунтом.',
  rate_limited: 'Слишком много запросов кода. Попробуйте позже.',
  failed: 'Не удалось привязать почту. Попробуйте ещё раз.',
};

function fail(reason: EmailLinkFailure): EmailLinkResult {
  return { success: false, reason, error: ERRORS[reason] };
}

const emailSchema = z.email();
const CODE_RE = /^\d{6}$/;

/** Подтверждённая почта пользователя (email-identity с `email_verified_at`) или `null`. */
export async function getVerifiedEmail(userId: UUID): Promise<string | null> {
  const identity = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.userId, userId),
      eq(userIdentities.provider, 'email'),
      isNotNull(userIdentities.emailVerifiedAt),
    ),
  });
  return identity?.providerId ?? null;
}

/**
 * Шаг 1: проверяет, что адрес можно привязать, и шлёт на него код. Пользователь
 * аутентифицирован — enumeration не проблема, поэтому даём ранние понятные ошибки
 * вместо «молчаливого успеха» логина. Исключение — пер-email лимит (общий бакет с
 * логином): там молча не шлём, как и при входе. Письмо отправляется в фоне.
 */
export async function requestEmailLinkCode(
  userId: UUID,
  rawEmail: string,
): Promise<EmailLinkResult> {
  const email = normalizeEmail(rawEmail);
  if (!emailSchema.safeParse(email).success) return fail('invalid_email');

  const own = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.userId, userId),
      eq(userIdentities.provider, 'email'),
    ),
  });
  if (own) {
    return fail(own.providerId === email ? 'already_linked' : 'has_other');
  }
  const taken = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.provider, 'email'),
      eq(userIdentities.providerId, email),
    ),
  });
  if (taken) return fail('exists');

  if (!emailLinkUserLimiter.hit(userId).allowed) return fail('rate_limited');

  if (emailCodeLimiter.hit(email).allowed) {
    try {
      const code = generateLoginCode();
      await issueLoginCode(email, hashCode(code));
      // Не ждём SMTP: сбой/задержка не должны держать HTTP-ответ или апдейт бота.
      void sendLoginCodeEmail(email, code, 'link').catch((err: unknown) => {
        console.error('Ошибка отправки кода привязки email:', err);
      });
    } catch (err) {
      console.error('Ошибка выпуска кода привязки email:', err);
    }
  }

  return { success: true, email };
}

/** Шаг 2: проверяет код и привязывает почту к `userId` (см. `linkEmailToUser`). */
export async function confirmEmailLink(
  userId: UUID,
  rawEmail: string,
  rawCode: string,
): Promise<EmailLinkResult> {
  const email = normalizeEmail(rawEmail);
  const code = rawCode.trim();
  if (!emailSchema.safeParse(email).success) return fail('invalid_email');
  if (!CODE_RE.test(code)) return fail('invalid_code');

  if (!(await verifyLoginCode(email, hashCode(code)))) {
    return fail('invalid_code');
  }

  try {
    const result = await linkEmailToUser(userId, email);
    if (result !== 'linked') return fail(result);
    return { success: true, email };
  } catch (err) {
    // Редкая гонка на UNIQUE или исчезнувший аккаунт — код уже погашен.
    console.error('Ошибка привязки email:', err);
    return fail('failed');
  }
}
