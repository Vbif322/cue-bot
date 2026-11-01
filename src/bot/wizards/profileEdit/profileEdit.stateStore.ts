import { TextSessionStore } from '@/bot/sessions/textSessionStore.js';
import { TEXT_SESSION_TTL_MS } from '@/bot/sessions/textSession.const.js';
import type { BotContext } from '@/bot/types.js';

export type ProfileEditField = 'name' | 'surname' | 'city';

export interface ProfileEditState {
  field: ProfileEditField;
}

/**
 * Хранилище состояния редактирования профиля (persistent, поверх Postgres).
 * Переживает рестарт бота, как и остальные текстовые сессии; регистрируется
 * в `profileCommand.ts` рядом со своим обработчиком текста.
 */
export class ProfileEditStateStore {
  readonly session = new TextSessionStore<ProfileEditState>('profile-edit', {
    ttlMs: TEXT_SESSION_TTL_MS.profileEdit,
  });

  async start(
    userId: number,
    field: ProfileEditField,
    ctx?: BotContext,
  ): Promise<void> {
    await this.session.start(userId, { field }, ctx);
  }

  async get(userId: number): Promise<ProfileEditState | undefined> {
    return this.session.get(userId);
  }

  async clear(userId: number): Promise<boolean> {
    return this.session.end(userId);
  }
}
