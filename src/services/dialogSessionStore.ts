import { and, eq, gt, lt } from 'drizzle-orm';

import { db } from '../db/db.js';
import { dialogSessions } from '../db/schema.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

/**
 * Persistent namespaced key-value хранилище диалогового состояния поверх Postgres.
 *
 * Заменяет in-memory `Map`'ы wizard'ов/диалогов: состояние переживает рестарт.
 * Один инстанс на namespace; ключ — обычно telegram userId.
 *
 * - `set` — upsert по PK (namespace, key), всегда продлевает `expiresAt = now + ttl`.
 * - `get`/`has` — игнорируют просроченные записи (`expiresAt > now`).
 * - Значение `T` должно быть JSON-сериализуемым (хранится в jsonb).
 *   Десериализация `Date` НЕ восстанавливается автоматически — нормализуйте у вызова.
 */
export class PgSessionStore<T> {
  constructor(
    private readonly namespace: string,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  async get(key: string | number): Promise<T | undefined> {
    const row = await db.query.dialogSessions.findFirst({
      where: and(
        eq(dialogSessions.namespace, this.namespace),
        eq(dialogSessions.key, String(key)),
        gt(dialogSessions.expiresAt, new Date()),
      ),
    });

    return row ? (row.data as T) : undefined;
  }

  async has(key: string | number): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async set(key: string | number, value: T): Promise<void> {
    const expiresAt = new Date(Date.now() + this.ttlMs);

    await db
      .insert(dialogSessions)
      .values({
        namespace: this.namespace,
        key: String(key),
        data: value,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [dialogSessions.namespace, dialogSessions.key],
        set: { data: value, expiresAt, updatedAt: new Date() },
      });
  }

  async delete(key: string | number): Promise<boolean> {
    const deleted = await db
      .delete(dialogSessions)
      .where(
        and(
          eq(dialogSessions.namespace, this.namespace),
          eq(dialogSessions.key, String(key)),
        ),
      )
      .returning({ key: dialogSessions.key });

    return deleted.length > 0;
  }
}

/**
 * Удаляет все просроченные диалоговые сессии из таблицы.
 * Чтения и так фильтруют по `expiresAt`; sweep не даёт таблице расти.
 *
 * @returns {Promise<number>} число удалённых строк
 */
export async function sweepExpiredDialogSessions(): Promise<number> {
  const deleted = await db
    .delete(dialogSessions)
    .where(lt(dialogSessions.expiresAt, new Date()))
    .returning({ key: dialogSessions.key });

  return deleted.length;
}
