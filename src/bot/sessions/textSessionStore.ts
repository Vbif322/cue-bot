import { PgSessionStore } from '@/services/dialogSessionStore.js';
import type { BotContext } from '../types.js';
import {
  endDisplacedSession,
  registeredNamespaces,
} from './textSessionRegistry.js';

export interface TextSessionStoreOptions<T> {
  ttlMs?: number;
  /** Восстановление доменных типов после jsonb (например, `Date`). */
  hydrate?: (raw: unknown) => T;
}

/**
 * Хранилище одной текстовой сессии (namespace) поверх `dialog_sessions`.
 *
 * Инвариант «у пользователя не больше одной текстовой сессии»: `start`
 * атомарно вытесняет сессии всех остальных зарегистрированных флоу, `update`
 * никогда не вставляет — вытесненная сессия не воскреснет от запоздалой записи.
 */
export class TextSessionStore<T> {
  private readonly pg: PgSessionStore<T>;
  private readonly hydrateFn: ((raw: unknown) => T) | undefined;

  constructor(
    readonly namespace: string,
    options: TextSessionStoreOptions<T> = {},
  ) {
    this.pg = new PgSessionStore<T>(namespace, options.ttlMs);
    this.hydrateFn = options.hydrate;
  }

  hydrate(raw: unknown): T {
    return this.hydrateFn ? this.hydrateFn(raw) : (raw as T);
  }

  async get(userId: number): Promise<T | undefined> {
    const raw = await this.pg.get(userId);
    return raw === undefined ? undefined : this.hydrate(raw);
  }

  /**
   * Начать (или перезапустить) сессию. Сессии других флоу завершаются; с `ctx`
   * им вызывается `onEnd(…, 'superseded')` (например, промпт фреймов
   * превращается обратно в карточку матча).
   */
  async start(userId: number, value: T, ctx?: BotContext): Promise<void> {
    const displaced = await this.pg.claim(
      userId,
      value,
      registeredNamespaces(),
    );
    if (!ctx) return;
    for (const session of displaced) {
      await endDisplacedSession(ctx, session);
    }
  }

  /** Обновить активную сессию. false — сессии уже нет (отменена/вытеснена/истекла). */
  async update(userId: number, value: T): Promise<boolean> {
    return this.pg.replace(userId, value);
  }

  async end(userId: number): Promise<boolean> {
    return this.pg.delete(userId);
  }
}
