import type { Filter } from 'grammy';

import {
  findActiveDialogSession,
  type NamespacedSession,
} from '@/services/dialogSessionStore.js';
import type { BotContext } from '../types.js';
import type { TextSessionStore } from './textSessionStore.js';

export type TextMessageContext = Filter<BotContext, 'message:text'>;
export type TextSessionEndReason = 'cancel' | 'superseded';

interface TextSessionDefBase<T> {
  store: TextSessionStore<T>;
  /** Человекочитаемое название, e.g. «создание турнира». */
  name: string;
  /** Ответ на /cancel, e.g. «Создание турнира отменено.» */
  cancelReply: string;
  /** Обработка текстового сообщения (не команды) активной сессии. */
  onText: (ctx: TextMessageContext, state: T) => Promise<void>;
  /** Уборка после /cancel или вытеснения другим флоу (строка уже удалена). */
  onEnd?: (
    ctx: BotContext,
    state: T,
    reason: TextSessionEndReason,
  ) => Promise<void>;
}

/**
 * `blocking` — wizard: пока он активен, чужие callback'и, команды и кнопки
 * меню блокируются (разрешены /cancel, текст и callback'и с `callbackPrefix`).
 * Не-blocking (мягкая) сессия ничего не блокирует, а любая команда или кнопка
 * меню её завершает.
 */
export type TextSessionDef<T> = TextSessionDefBase<T> &
  ({ blocking: true; callbackPrefix: string } | { blocking: false });

/** Метаданные сессии, которых достаточно для решений маршрутизации. */
export interface TextSessionInfo {
  namespace: string;
  name: string;
  blocking: boolean;
  callbackPrefix: string | undefined;
}

export interface RegisteredTextSession extends TextSessionInfo {
  cancelReply: string;
  handleText: (ctx: TextMessageContext, raw: unknown) => Promise<void>;
  handleEnd: (
    ctx: BotContext,
    raw: unknown,
    reason: TextSessionEndReason,
  ) => Promise<void>;
  end: (userId: number) => Promise<boolean>;
}

export interface ActiveTextSession {
  session: RegisteredTextSession;
  data: unknown;
}

const registry = new Map<string, RegisteredTextSession>();

/**
 * Регистрирует текстовый флоу. Только зарегистрированные сессии получают текст
 * (единый диспетчер), /cancel и участвуют в правиле «одна сессия на пользователя».
 */
export function registerTextSession<T>(def: TextSessionDef<T>): void {
  const { store } = def;
  if (registry.has(store.namespace)) {
    throw new Error(
      `Текстовая сессия "${store.namespace}" уже зарегистрирована`,
    );
  }

  registry.set(store.namespace, {
    namespace: store.namespace,
    name: def.name,
    blocking: def.blocking,
    callbackPrefix: def.blocking ? def.callbackPrefix : undefined,
    cancelReply: def.cancelReply,
    handleText: (ctx, raw) => def.onText(ctx, store.hydrate(raw)),
    handleEnd: async (ctx, raw, reason) => {
      if (def.onEnd) await def.onEnd(ctx, store.hydrate(raw), reason);
    },
    end: (userId) => store.end(userId),
  });
}

export function registeredNamespaces(): string[] {
  return [...registry.keys()];
}

/** Активная текстовая сессия пользователя — одним запросом. */
export async function getActiveTextSession(
  userId: number,
): Promise<ActiveTextSession | undefined> {
  const row = await findActiveDialogSession(userId, registeredNamespaces());
  if (!row) return undefined;
  const session = registry.get(row.namespace);
  return session ? { session, data: row.data } : undefined;
}

async function runEnd(
  ctx: BotContext,
  session: RegisteredTextSession,
  raw: unknown,
  reason: TextSessionEndReason,
): Promise<void> {
  try {
    await session.handleEnd(ctx, raw, reason);
  } catch (error) {
    console.error(`Text session "${session.namespace}" onEnd failed:`, error);
  }
}

/**
 * Завершить активную сессию: удалить строку и вызвать `onEnd`. Если строки уже
 * нет (параллельно завершена), `onEnd` не вызывается.
 *
 * @returns {Promise<boolean>} true, если сессия была завершена этим вызовом
 */
export async function endTextSession(
  ctx: BotContext,
  userId: number,
  active: ActiveTextSession,
  reason: TextSessionEndReason,
): Promise<boolean> {
  if (!(await active.session.end(userId))) return false;
  await runEnd(ctx, active.session, active.data, reason);
  return true;
}

/** `onEnd(…, 'superseded')` для сессии, уже удалённой `claim`'ом. */
export async function endDisplacedSession(
  ctx: BotContext,
  displaced: NamespacedSession,
): Promise<void> {
  const session = registry.get(displaced.namespace);
  if (session) await runEnd(ctx, session, displaced.data, 'superseded');
}
