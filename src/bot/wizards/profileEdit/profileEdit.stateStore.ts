import { PgSessionStore } from '@/services/dialogSessionStore.js';

export type ProfileEditField = 'name' | 'surname';

interface ProfileEditState {
  field: ProfileEditField;
}

/**
 * Хранилище состояния редактирования профиля (persistent, поверх Postgres).
 * Переживает рестарт бота, как и остальные wizard'ы.
 */
export class ProfileEditStateStore {
  private readonly store = new PgSessionStore<ProfileEditState>('profile-edit');

  async start(userId: number, field: ProfileEditField): Promise<void> {
    await this.store.set(userId, { field });
  }

  async get(userId: number): Promise<ProfileEditState | undefined> {
    return this.store.get(userId);
  }

  async has(userId: number): Promise<boolean> {
    return this.store.has(userId);
  }

  async clear(userId: number): Promise<boolean> {
    return this.store.delete(userId);
  }
}
