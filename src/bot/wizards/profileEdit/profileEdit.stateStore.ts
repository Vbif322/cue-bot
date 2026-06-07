export type ProfileEditField = 'name' | 'surname';

interface ProfileEditState {
  field: ProfileEditField;
}

/**
 * Лёгкое in-memory хранилище состояния редактирования профиля.
 * Сессии теряются при перезапуске бота (как и у остальных wizard'ов).
 */
export class ProfileEditStateStore {
  private readonly storage = new Map<number, ProfileEditState>();

  start(userId: number, field: ProfileEditField): void {
    this.storage.set(userId, { field });
  }

  get(userId: number): ProfileEditState | undefined {
    return this.storage.get(userId);
  }

  has(userId: number): boolean {
    return this.storage.has(userId);
  }

  clear(userId: number): boolean {
    return this.storage.delete(userId);
  }
}
