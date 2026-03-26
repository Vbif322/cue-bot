import type {
  ICreationData,
  ICreationState,
  ICreationStep,
} from './tournamentCreation.js';

// #region Types / Interfaces

export interface ITournamentCreationStateStore {
  start(userId: number): ICreationState;

  get(userId: number): ICreationState | undefined;
  getOrThrow(userId: number): ICreationState;

  has(userId: number): boolean;
  hasStep(userId: number, step: ICreationStep): boolean;
  ensureStep(userId: number, step: ICreationStep): ICreationState;

  setStep(userId: number, step: ICreationStep): ICreationState;
  updateData(userId: number, data: Partial<ICreationData>): ICreationState;
  update(userId: number, patch: Partial<ICreationState>): ICreationState;

  clear(userId: number): boolean;
}

// #endregion

// #region Class

/** Хранение сессии */
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

    if (!state) throw new Error('Сессия не найдена');

    return state;
  }

  /**
   * Проверяет, находится ли пользователь в состоянии создания турнира
   *
   * @param {number} userId ID пользователя
   *
   * @returns {boolean} true, если находится, false в противном случае
   */
  public has(userId: number): boolean {
    return this.storage.has(userId);
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

    return state?.step === step;
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

        ...(patch.venue
          ? {
              venue: state.data.venue
                ? { ...state.data.venue, ...patch.venue }
                : patch.venue,
            }
          : {}),

        ...(patch.tournament
          ? {
              tournament: state.data.tournament
                ? { ...state.data.tournament, ...patch.tournament }
                : patch.tournament,
            }
          : {}),

        ...(patch.tableIds !== undefined ? { tableIds: patch.tableIds } : {}),
      },
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
    if (patch.step) this.setStep(userId, patch.step);
    if (patch.data) this.updateData(userId, patch.data);

    return this.getOrThrow(userId);
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
