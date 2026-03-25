import type { IDiscipline, ITournamentFormat } from '../../db/schema.js';

// #region Types / Interfaces

export type ICreationStep = (typeof CREATION_STEPS)[number];

export interface ICreationData {
  venueId?: string;
  venueName?: string;

  name?: string;
  discipline?: IDiscipline;
  format?: ITournamentFormat;
  maxParticipants?: number;
  winScore?: number;
  startDate?: Date;

  tableIds?: string[];
}

export interface ICreationState {
  step: ICreationStep;
  data: ICreationData;
}

export interface ITournamentCreationStateStore {
  start(userId: number): ICreationState;
}

// #endregion

// #region Constants

export const CREATION_STEPS = [
  'name',
  'date',
  'venue',
  'discipline',
  'format',
  'maxParticipants',
  'winScore',
  'tables',
] as const;

// #endregion

// #region Class

export class TournamentCreationStateStore implements ITournamentCreationStateStore {
  // TODO: Replace with database-backed sessions for production
  // This in-memory storage will be lost on bot restart
  private readonly storage = new Map<number, ICreationState>();

  /**
   * Создание состояния создания турнира для пользователя
   *
   * @param {number} userId ID пользователя
   *
   * @returns {ICreationState} Состояние создания
   */
  start(userId: number): ICreationState {
    const state: ICreationState = {
      step: 'name',
      data: {},
    };

    this.storage.set(userId, state);

    return state;
  }

  /**
   * Получение состояния создания турнира для пользователя
   *
   * @param {number} userId ID пользователя
   *
   * @returns {ICreationState | undefined} Состояние создания или undefined, если сессия не найдена
   */
  get(userId: number): ICreationState | undefined {
    return this.storage.get(userId);
  }

  /**
   * Возвращает состояние создания турнира для пользователя
   * Если сессия не найдена, то бросает ошибку
   *
   * @throws {Error} Сессия не найдена
   *
   * @param {number} userId ID пользователя
   *
   * @returns {ICreationState} Состояние создания
   */
  getOrThrow(userId: number): ICreationState {
    const state = this.get(userId);

    if (!state) {
      throw new Error('Сессия не найдена');
    }

    return state;
  }

  /**
   * Проверяет, есть ли у пользователя состояние создания с заданным шагом
   *
   * @param {number} userId ID пользователя
   * @param {ICreationStep} step Шаг, который ожидается
   *
   * @returns {boolean} true, состояние создания совпадает, false в противном случае
   */
  hasStep(userId: number, step: ICreationStep): boolean {
    const state = this.get(userId);

    if (state === undefined) return false;

    if (state.step !== step) return false;

    return true;
  }

  /**
   * Проверяет, что текущий шаг состояния создания турнира соответствует заданному шагу
   *
   * @throws {Error} Сессия не найдена
   * @throws {Error} Ошибка, если шаги не совпадают
   *
   * @param {number} userId ID пользователя
   * @param {ICreationStep} step Шаг, который ожидается
   *
   * @returns {ICreationState} Состояние создания
   */
  ensureStep(userId: number, step: ICreationStep): ICreationState {
    const state = this.getOrThrow(userId);

    if (state.step !== step) {
      throw new Error(`Ожидался шаг "${step}", текущий шаг "${state.step}"`);
    }

    return state;
  }

  /**
   * Обновить данные создания турнира с помощью частичных данных
   *
   * Используется, когда необходимо изменить только параметры турнира,
   * не влияя на текущий шаг процесса создания
   *
   * @throws {Error} Сессия не найдена
   *
   * @param {number} userId ID пользователя
   * @param {Partial<ICreationData>} patch Данные создания для обновления
   *
   * @returns {ICreationState} Обновленное состояние создания
   */
  updateData(userId: number, patch: Partial<ICreationData>): ICreationState {
    const state = this.getOrThrow(userId);

    const nextState: ICreationState = {
      ...state,
      data: {
        ...state.data,
        ...patch,
      },
    };

    this.storage.set(userId, nextState);

    return nextState;
  }

  /**
   * Обновить шаг состояния создания турнира
   *
   * Используется, когда необходимо изменить только текущий шаг процесса создания,
   * не влияя на параметры турнира
   *
   * @throws {Error} Сессия не найдена
   *
   * @param {number} userId ID пользователя
   * @param {ICreationStep} step Новый шаг состояния создания
   *
   * @returns {ICreationState} Обновленное состояние создания
   */
  setStep(userId: number, step: ICreationStep): ICreationState {
    const state = this.getOrThrow(userId);

    const nextState: ICreationState = {
      ...state,
      step,
    };

    this.storage.set(userId, nextState);

    return nextState;
  }

  /**
   * Обновить состояние создания турнира с помощью частичных данных и шага
   *
   * Используется, когда необходимо изменить и параметры турнира и шаг процесса создания
   *
   * @throws {Error} Сессия не найдена
   *
   * @param {number} userId ID пользователя
   * @param {Partial<ICreationState>} patch Данные создания для обновления и шаг
   *
   * @returns {ICreationState} Обновленное состояние создания
   */
  update(userId: number, patch: Partial<ICreationState>): ICreationState {
    const state = this.getOrThrow(userId);

    const nextState: ICreationState = {
      ...state,
      ...patch,
      data: {
        ...state.data,
        ...(patch.data ?? {}),
      },
    };

    this.storage.set(userId, nextState);

    return nextState;
  }

  /**
   * Удалить состояние создания турнира для пользователя
   *
   * @param {number} userId ID пользователя
   *
   * @returns {boolean} true, если сессия была удалена, false в противном случае
   */
  clear(userId: number): boolean {
    return this.storage.delete(userId);
  }
}

// #endregion
