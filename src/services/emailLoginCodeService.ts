import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { emailLoginCodes } from '@/db/schema.js';

/** TTL кода входа. */
export const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
/** Максимум попыток ввода на один код (включительно). */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Гасит все живые коды адреса и сохраняет новый (одна транзакция, чтобы в любой
 * момент у адреса был максимум один действующий код). `email` — уже нормализован,
 * `codeHash` — sha256(hex) от plaintext-кода.
 */
export async function issueLoginCode(
  email: string,
  codeHash: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + LOGIN_CODE_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .update(emailLoginCodes)
      .set({ usedAt: new Date() })
      .where(
        and(eq(emailLoginCodes.email, email), isNull(emailLoginCodes.usedAt)),
      );
    await tx.insert(emailLoginCodes).values({ email, codeHash, expiresAt });
  });
}

/**
 * Атомарно проверяет код: инкрементирует `attempts` у последнего живого кода
 * адреса и, только если хэш совпал, гасит его (`used_at = now()`). Один statement
 * исключает окно двойного погашения. Возвращает `true` при верном коде.
 *
 * `false` покрывает все провалы: неверный хэш, истёкший/погашенный код,
 * исчерпанные попытки (≥ {@link MAX_CODE_ATTEMPTS}) или отсутствие кода.
 */
export async function verifyLoginCode(
  email: string,
  codeHash: string,
): Promise<boolean> {
  const result = await db.execute<{ ok: boolean }>(sql`
    UPDATE "prod"."email_login_codes"
    SET attempts = attempts + 1,
        used_at = CASE WHEN code_hash = ${codeHash} THEN now() ELSE used_at END
    WHERE id = (
      SELECT id FROM "prod"."email_login_codes"
      WHERE email = ${email}
        AND used_at IS NULL
        AND expires_at > now()
        AND attempts < ${MAX_CODE_ATTEMPTS}
      ORDER BY created_at DESC
      LIMIT 1
    )
    RETURNING (used_at IS NOT NULL) AS ok
  `);
  return result.rows[0]?.ok === true;
}

/**
 * Удаляет просроченные коды, чтобы таблица не росла (чтения и так фильтруют по
 * `expires_at`). Вызывается часовым sweep-интервалом в `src/index.ts`.
 *
 * @returns число удалённых строк
 */
export async function sweepExpiredEmailLoginCodes(): Promise<number> {
  const deleted = await db
    .delete(emailLoginCodes)
    .where(lt(emailLoginCodes.expiresAt, new Date()))
    .returning({ id: emailLoginCodes.id });
  return deleted.length;
}
