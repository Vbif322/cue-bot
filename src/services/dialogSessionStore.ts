import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';

import { db } from '../db/db.js';
import { dialogSessions } from '../db/schema.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

/** Сессия вместе с её namespace (вытесненная `claim` / найденная `findActiveDialogSession`). */
export interface NamespacedSession {
  namespace: string;
  data: unknown;
}

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
    readonly namespace: string,
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

  /**
   * Эксклюзивный старт: в одной транзакции удаляет сессии этого ключа в других
   * namespace из `scope` и записывает свою (upsert). Advisory-lock по ключу
   * сериализует параллельные claim'ы — у ключа остаётся ровно одна сессия из `scope`.
   *
   * @returns {Promise<NamespacedSession[]>} вытесненные непросроченные сессии
   */
  async claim(
    key: string | number,
    value: T,
    scope: readonly string[],
  ): Promise<NamespacedSession[]> {
    const k = String(key);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const others = scope.filter((ns) => ns !== this.namespace);

    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`dialog_sessions:${k}`}))`,
      );

      const displaced =
        others.length === 0
          ? []
          : await tx
              .delete(dialogSessions)
              .where(
                and(
                  eq(dialogSessions.key, k),
                  inArray(dialogSessions.namespace, others),
                ),
              )
              .returning({
                namespace: dialogSessions.namespace,
                data: dialogSessions.data,
                expiresAt: dialogSessions.expiresAt,
              });

      await tx
        .insert(dialogSessions)
        .values({ namespace: this.namespace, key: k, data: value, expiresAt })
        .onConflictDoUpdate({
          target: [dialogSessions.namespace, dialogSessions.key],
          set: { data: value, expiresAt, updatedAt: now },
        });

      return displaced
        .filter((row) => row.expiresAt > now)
        .map(({ namespace, data }) => ({ namespace, data }));
    });
  }

  /**
   * Обновляет ТОЛЬКО существующую непросроченную сессию (и продлевает TTL).
   * В отличие от `set`, никогда не вставляет — сессию, которую уже вытеснили
   * или отменили, запоздалое обновление не воскресит.
   *
   * @returns {Promise<boolean>} false, если сессии нет
   */
  async replace(key: string | number, value: T): Promise<boolean> {
    const now = new Date();
    const updated = await db
      .update(dialogSessions)
      .set({
        data: value,
        expiresAt: new Date(now.getTime() + this.ttlMs),
        updatedAt: now,
      })
      .where(
        and(
          eq(dialogSessions.namespace, this.namespace),
          eq(dialogSessions.key, String(key)),
          gt(dialogSessions.expiresAt, now),
        ),
      )
      .returning({ key: dialogSessions.key });

    return updated.length > 0;
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
 * Активная (непросроченная) сессия ключа среди `namespaces` — одним запросом.
 * При коллизии (не должно случаться при старте через `claim`) — самая свежая.
 */
export async function findActiveDialogSession(
  key: string | number,
  namespaces: readonly string[],
): Promise<NamespacedSession | undefined> {
  if (namespaces.length === 0) return undefined;

  const row = await db.query.dialogSessions.findFirst({
    columns: { namespace: true, data: true },
    where: and(
      eq(dialogSessions.key, String(key)),
      inArray(dialogSessions.namespace, [...namespaces]),
      gt(dialogSessions.expiresAt, new Date()),
    ),
    orderBy: [desc(dialogSessions.updatedAt)],
  });

  return row;
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
