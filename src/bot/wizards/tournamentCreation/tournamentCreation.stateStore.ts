import { TextSessionStore } from '@/bot/sessions/textSessionStore.js';
import { TEXT_SESSION_TTL_MS } from '@/bot/sessions/textSession.const.js';
import type { BotContext } from '@/bot/types.js';

import type {
  ICreationData,
  ICreationState,
  ICreationStep,
} from './tournamentCreation.js';

// #region Types / Interfaces

export interface ITournamentCreationStateStore {
  start(
    userId: number,
    ctx?: BotContext,
    initial?: Partial<ICreationState>,
  ): Promise<ICreationState>;

  get(userId: number): Promise<ICreationState | undefined>;
  getOrThrow(userId: number): Promise<ICreationState>;

  has(userId: number): Promise<boolean>;
  hasStep(userId: number, step: ICreationStep): Promise<boolean>;
  ensureStep(userId: number, step: ICreationStep): Promise<ICreationState>;

  setStep(userId: number, step: ICreationStep): Promise<ICreationState>;
  updateData(
    userId: number,
    data: Partial<ICreationData>,
  ): Promise<ICreationState>;
  update(
    userId: number,
    patch: Partial<ICreationState>,
  ): Promise<ICreationState>;

  clear(userId: number): Promise<boolean>;
}

// #endregion

// #region Pure helpers

/**
 * Чистое слияние данных создания турнира с частичным патчем.
 *
 * `venue` и `tournament` сливаются по полям, `tables` — заменяется целиком
 * (если передан). Вынесено отдельно от хранилища, чтобы покрывать unit-тестом
 * без БД.
 *
 * @param {ICreationData} prev Текущие данные
 * @param {Partial<ICreationData>} patch Частичный патч
 *
 * @returns {ICreationData} Слитые данные
 */
export function mergeCreationData(
  prev: ICreationData,
  patch: Partial<ICreationData>,
): ICreationData {
  return {
    ...prev,

    ...(patch.federation ? { federation: patch.federation } : {}),

    ...(patch.venue
      ? { venue: prev.venue ? { ...prev.venue, ...patch.venue } : patch.venue }
      : {}),

    ...(patch.tournament
      ? {
          tournament: prev.tournament
            ? { ...prev.tournament, ...patch.tournament }
            : patch.tournament,
        }
      : {}),

    ...(patch.tables !== undefined
      ? { tables: patch.tables }
      : { tables: prev.tables ?? [] }),
  };
}

/**
 * Восстанавливает доменные типы после round-trip через JSONB.
 *
 * `startDate` хранится в jsonb как ISO-строка; код-потребитель ждёт `Date`.
 * Нормализуем строку обратно в `Date` при чтении.
 *
 * @param {unknown} raw Состояние из БД
 *
 * @returns {ICreationState} Состояние с восстановленными типами
 */
export function normalizeCreationState(raw: unknown): ICreationState {
  const state = raw as ICreationState;
  const startDate = state.data.tournament?.startDate;

  if (typeof startDate === 'string') {
    return {
      ...state,
      data: {
        ...state.data,
        tournament: {
          ...state.data.tournament,
          startDate: new Date(startDate),
        },
      },
    };
  }

  return state;
}

// #endregion

// #region Class

/** Хранение сессии создания турнира (persistent, поверх Postgres). */
export class TournamentCreationStateStore implements ITournamentCreationStateStore {
  /** Текстовая сессия wizard'а (namespace `tc`); регистрируется в модуле. */
  readonly session = new TextSessionStore<ICreationState>('tc', {
    ttlMs: TEXT_SESSION_TTL_MS.tournamentCreation,
    hydrate: normalizeCreationState,
  });

  /**
   * Создание состояния создания турнира для пользователя
   *
   * Сессии других текстовых флоу пользователя завершаются (с `ctx` — с их `onEnd`).
   *
   * @param {number} userId ID пользователя
   * @param {BotContext} [ctx] Контекст бота
   *
   * @returns {Promise<ICreationState>} Состояние создания
   */
  async start(
    userId: number,
    ctx?: BotContext,
    initial?: Partial<ICreationState>,
  ): Promise<ICreationState> {
    const state: ICreationState = {
      step: initial?.step ?? 'name',
      data: {
        tables: [],
        ...initial?.data,
      },
    };

    await this.session.start(userId, state, ctx);

    return state;
  }

  /**
   * Получение состояния создания турнира для пользователя
   *
   * @param {number} userId ID пользователя
   *
   * @returns {Promise<ICreationState | undefined>} Состояние или undefined
   */
  async get(userId: number): Promise<ICreationState | undefined> {
    return this.session.get(userId);
  }

  /**
   * Возвращает состояние создания турнира для пользователя
   * Если сессия не найдена, то бросает ошибку
   *
   * @throws {Error} Сессия не найдена
   *
   * @param {number} userId ID пользователя
   *
   * @returns {Promise<ICreationState>} Состояние создания
   */
  async getOrThrow(userId: number): Promise<ICreationState> {
    const state = await this.get(userId);

    if (!state) throw new Error('Сессия не найдена');

    return state;
  }

  /**
   * Проверяет, находится ли пользователь в состоянии создания турнира
   *
   * @param {number} userId ID пользователя
   *
   * @returns {Promise<boolean>} true, если находится
   */
  async has(userId: number): Promise<boolean> {
    return (await this.get(userId)) !== undefined;
  }

  /**
   * Проверяет, есть ли у пользователя состояние создания с заданным шагом
   *
   * @param {number} userId ID пользователя
   * @param {ICreationStep} step Шаг, который ожидается
   *
   * @returns {Promise<boolean>} true, если шаг совпадает
   */
  async hasStep(userId: number, step: ICreationStep): Promise<boolean> {
    const state = await this.get(userId);

    return state?.step === step;
  }

  /**
   * Проверяет, что текущий шаг состояния создания турнира соответствует заданному
   *
   * @throws {Error} Сессия не найдена
   * @throws {Error} Ошибка, если шаги не совпадают
   *
   * @param {number} userId ID пользователя
   * @param {ICreationStep} step Шаг, который ожидается
   *
   * @returns {Promise<ICreationState>} Состояние создания
   */
  async ensureStep(
    userId: number,
    step: ICreationStep,
  ): Promise<ICreationState> {
    const state = await this.getOrThrow(userId);

    if (state.step !== step) {
      throw new Error(`Ожидался шаг "${step}", текущий шаг "${state.step}"`);
    }

    return state;
  }

  /**
   * Обновить шаг состояния создания турнира
   *
   * @throws {Error} Сессия не найдена
   *
   * @param {number} userId ID пользователя
   * @param {ICreationStep} step Новый шаг состояния создания
   *
   * @returns {Promise<ICreationState>} Обновленное состояние создания
   */
  async setStep(userId: number, step: ICreationStep): Promise<ICreationState> {
    const state = await this.getOrThrow(userId);

    const nextState: ICreationState = {
      ...state,
      step,
    };

    await this.write(userId, nextState);

    return nextState;
  }

  /**
   * Обновить данные создания турнира с помощью частичных данных
   *
   * @throws {Error} Сессия не найдена
   *
   * @param {number} userId ID пользователя
   * @param {Partial<ICreationData>} patch Данные создания для обновления
   *
   * @returns {Promise<ICreationState>} Обновленное состояние создания
   */
  async updateData(
    userId: number,
    patch: Partial<ICreationData>,
  ): Promise<ICreationState> {
    const state = await this.getOrThrow(userId);

    const nextState: ICreationState = {
      ...state,
      data: mergeCreationData(state.data, patch),
    };

    await this.write(userId, nextState);

    return nextState;
  }

  /**
   * Обновить состояние создания турнира (шаг и/или данные) одной записью.
   *
   * @throws {Error} Сессия не найдена
   *
   * @param {number} userId ID пользователя
   * @param {Partial<ICreationState>} patch Шаг и/или данные для обновления
   *
   * @returns {Promise<ICreationState>} Обновленное состояние создания
   */
  async update(
    userId: number,
    patch: Partial<ICreationState>,
  ): Promise<ICreationState> {
    const current = await this.getOrThrow(userId);

    let next = current;

    if (patch.step) next = { ...next, step: patch.step };
    if (patch.data)
      next = { ...next, data: mergeCreationData(next.data, patch.data) };

    await this.write(userId, next);

    return next;
  }

  /**
   * Удалить состояние создания турнира для пользователя
   *
   * @param {number} userId ID пользователя
   *
   * @returns {Promise<boolean>} true, если сессия была удалена
   */
  async clear(userId: number): Promise<boolean> {
    return this.session.end(userId);
  }

  /** Записать состояние активной сессии; сессия не воскрешается после отмены/вытеснения. */
  private async write(userId: number, state: ICreationState): Promise<void> {
    if (!(await this.session.update(userId, state))) {
      throw new Error('Сессия не найдена');
    }
  }
}

// #endregion
