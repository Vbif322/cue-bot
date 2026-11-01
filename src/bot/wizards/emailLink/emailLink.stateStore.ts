import { TextSessionStore } from '@/bot/sessions/textSessionStore.js';
import { TEXT_SESSION_TTL_MS } from '@/bot/sessions/textSession.const.js';
import type { BotContext } from '@/bot/types.js';

/** Ждём адрес почты → ждём 6-значный код, отправленный на `email`. */
export type EmailLinkState =
  { step: 'email' } | { step: 'code'; email: string };

/**
 * Хранилище состояния привязки почты (persistent, поверх Postgres). Регистрируется
 * в `profileCommand.ts` рядом со своим обработчиком текста.
 */
export class EmailLinkStateStore {
  readonly session = new TextSessionStore<EmailLinkState>('email-link', {
    ttlMs: TEXT_SESSION_TTL_MS.emailLink,
  });

  async start(userId: number, ctx?: BotContext): Promise<void> {
    await this.session.start(userId, { step: 'email' }, ctx);
  }

  async get(userId: number): Promise<EmailLinkState | undefined> {
    return this.session.get(userId);
  }

  /** false — сессии уже нет (отменена/вытеснена/истекла). */
  async awaitCode(userId: number, email: string): Promise<boolean> {
    return this.session.update(userId, { step: 'code', email });
  }

  async awaitEmail(userId: number): Promise<boolean> {
    return this.session.update(userId, { step: 'email' });
  }

  async clear(userId: number): Promise<boolean> {
    return this.session.end(userId);
  }
}
