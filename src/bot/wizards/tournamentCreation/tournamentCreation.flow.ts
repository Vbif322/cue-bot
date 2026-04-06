import type { UUID } from 'crypto';

import {
  disciplines,
  maxParticipants,
  formats,
  winScores,
} from '@/db/schema.js';
import { getVenue, getVenues } from '@/services/venueService.js';
import { getTablesByVenue } from '@/services/tableService.js';
import { createTournamentDraft } from '@/services/tournamentService.js';
import type { IDateTimeHelper } from '@/utils/dateTimeHelper.js';
import type {
  ITournamentDiscipline,
  ITournamentMaxParticipants,
  ITournamentFormat,
  ITournamentWinScore,
} from '@/db/schema.js';

import type { BotContext } from '../../types.js';
import type {
  ICreationData,
  ICreationState,
  ICreationStep,
  IRequiredCreationData,
} from './tournamentCreation.js';
import type { ITournamentCreationRenderer } from './tournamentCreation.renderer.js';
import type { ITournamentCreationStateStore } from './tournamentCreation.stateStore.js';

// #region Types / Interfaces

export interface ITournamentCreationFlow {
  startCreationWizard(ctx: BotContext): Promise<void>;

  cancelCreation(userId: number): boolean;

  getCreationState(userId: number): ICreationState | undefined;

  handleNameInput(ctx: BotContext, name: string): Promise<boolean>;

  handleStartDateInput(ctx: BotContext, startDate: string): Promise<boolean>;

  handleVenueSelection(ctx: BotContext, venueId: UUID): Promise<boolean>;

  handleDisciplineSelection(
    ctx: BotContext,
    discipline: string,
  ): Promise<boolean>;

  handleFormatSelection(ctx: BotContext, format: string): Promise<boolean>;

  handleMaxParticipantsSelection(
    ctx: BotContext,
    maxParticipants: number,
  ): Promise<boolean>;

  handleWinScoreSelection(ctx: BotContext, winScore: number): Promise<boolean>;

  handleTableSelectionToggle(ctx: BotContext, tableId: UUID): Promise<boolean>;

  handleTableSelectionFinalize(
    ctx: BotContext,
    isSkip: boolean,
  ): Promise<boolean>;
}

// #endregion

// #region Class

export class TournamentCreationFlow implements ITournamentCreationFlow {
  constructor(
    private readonly stateStore: ITournamentCreationStateStore,
    private readonly renderer: ITournamentCreationRenderer,
    private readonly dateTimeHelper: IDateTimeHelper,
  ) {}

  /**
   * Запускает мастер создания турнира для пользователя
   *
   * @param {BotContext} ctx Контекст бота
   *
   * @returns {Promise<void>}
   */
  async startCreationWizard(ctx: BotContext): Promise<void> {
    const userId = this.getUserId(ctx);

    if (!userId) return;

    this.stateStore.start(userId);

    await this.renderer.showNameStep(ctx);
  }

  /**
   * Отмена создания турнира для пользователя
   *
   * @param {number} userId Идентификатор пользователя
   *
   * @returns {boolean} true, если создание было отменено, в противном случае — false
   */
  cancelCreation(userId: number): boolean {
    return this.stateStore.clear(userId);
  }

  /**
   * Получение состояния создания турнира для пользователя
   *
   * @param {number} userId ID пользователя
   *
   * @returns {ICreationState | undefined} Состояние создания или undefined, если сессия не найдена
   */
  getCreationState(userId: number): ICreationState | undefined {
    return this.stateStore.get(userId);
  }

  /**
   * Обрабатывает ввод имени турнира пользователем
   *
   * Проверяет, находится ли пользователь на этапе ввода имени,
   * и при успехе переводит процесс создания турнира на следующий шаг (ввод даты начала турнира).
   *
   * @param {BotContext} ctx Контекст бота
   * @param {string} name Введённое пользователем имя турнира
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleNameInput(ctx: BotContext, name: string): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'name',
      false,
    );

    if (!hasStep) return false;

    const clearedName = name.trim();

    if (clearedName.length < 3) {
      await this.renderer.showInvalidName(ctx);

      return true;
    }

    const state = this.stateStore.update(userId, {
      step: 'date',
      data: {
        tournament: {
          name: clearedName,
        },
      },
    });

    if (state.step !== 'date' || state.data.tournament?.name !== clearedName) {
      return false;
    }

    await this.renderer.showStartDateStep(ctx, clearedName);

    return true;
  }

  /**
   * Обрабатывает ввод даты создания турнира пользователем
   *
   * @param {BotContext} ctx Контекст бота
   * @param {string} startDate Введенная пользователем дата в формате строки
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleStartDateInput(
    ctx: BotContext,
    startDate: string,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'date',
      false,
    );

    if (!hasStep) return false;

    const parsedDate = this.dateTimeHelper.toDate(startDate.trim());

    if (!parsedDate.status) {
      await this.renderer.showInvalidDate(ctx);

      return true;
    }

    const state = this.stateStore.update(userId, {
      step: 'venue',
      data: {
        tournament: {
          startDate: parsedDate.datetime,
        },
      },
    });

    if (
      state.step !== 'venue' ||
      state.data.tournament?.startDate?.toISOString() !==
        parsedDate.datetime.toISOString()
    ) {
      return false;
    }

    const venues = await getVenues();

    if (venues.length === 0) {
      this.stateStore.clear(userId);

      await this.renderer.showNoVenues(ctx);

      return false;
    }

    await this.renderer.showVenueStep(ctx, parsedDate.datetime, venues);

    return true;
  }

  /**
   * Обрабатывает выбор площадки создания турнира пользователем
   *
   * @param {BotContext} ctx Контекст бота
   * @param {UUID} venueId ID выбранной площадки
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleVenueSelection(ctx: BotContext, venueId: UUID): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'venue',
    );

    if (!hasStep) return false;

    const venue = await getVenue(venueId);

    if (venue === null) {
      await this.renderer.showVenueNotFound(ctx);

      return true;
    }

    const state = this.stateStore.update(userId, {
      step: 'discipline',
      data: {
        venue: {
          id: venue.id,
          name: venue.name,
        },
      },
    });

    if (state.step !== 'discipline' || state.data.venue?.id !== venue.id) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    await ctx.answerCallbackQuery();

    await this.renderer.showDisciplineStep(ctx, venue.name);

    return true;
  }

  /**
   * Обрабатывает выбор дисциплины создания турнира пользователем
   *
   * @param {BotContext} ctx Контекст бота
   * @param {string} discipline Выбранная пользователем дисциплина
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleDisciplineSelection(
    ctx: BotContext,
    discipline: string,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'discipline',
    );

    if (!hasStep) return false;

    if (!this.isDiscipline(discipline)) {
      await this.renderer.showInvalidDiscipline(ctx);

      return true;
    }

    const state = this.stateStore.update(userId, {
      step: 'format',
      data: {
        tournament: {
          discipline,
        },
      },
    });

    if (
      state.step !== 'format' ||
      state.data.tournament?.discipline !== discipline
    ) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    await ctx.answerCallbackQuery();

    await this.renderer.showFormatStep(ctx, discipline);

    return true;
  }

  /**
   * Обрабатывает выбор формата турнира пользователем
   *
   * @param {BotContext} ctx Контекст бота
   * @param {string} format Выбранный формат турнира
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleFormatSelection(
    ctx: BotContext,
    format: string,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'format',
    );

    if (!hasStep) return false;

    if (!this.isTournamentFormat(format)) {
      await this.renderer.showInvalidFormat(ctx);

      return true;
    }

    const state = this.stateStore.update(userId, {
      step: 'maxParticipants',
      data: {
        tournament: {
          format,
        },
      },
    });

    if (
      state.step !== 'maxParticipants' ||
      state.data.tournament?.format !== format
    ) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    await ctx.answerCallbackQuery();

    await this.renderer.showMaxParticipantsStep(ctx, format);

    return true;
  }

  /**
   * Обрабатывает выбор максимального количества участников турнира пользователем
   *
   * @param {BotContext} ctx Контекст бота
   * @param {number} maxParticipants Выбранное количество участников
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleMaxParticipantsSelection(
    ctx: BotContext,
    maxParticipants: number,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'maxParticipants',
    );

    if (!hasStep) return false;

    if (!this.isAllowedParticipantsCount(maxParticipants)) {
      await this.renderer.showIncorrectMaxParticipants(ctx);

      return true;
    }

    const state = this.stateStore.update(userId, {
      step: 'winScore',
      data: {
        tournament: {
          maxParticipants,
        },
      },
    });

    if (
      state.step !== 'winScore' ||
      state.data.tournament?.maxParticipants !== maxParticipants
    ) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    await ctx.answerCallbackQuery();

    await this.renderer.showWinScoreStep(ctx, maxParticipants);

    return true;
  }

  /**
   * Обрабатывает выбор количества побед для турнира пользователем
   *
   * @param {BotContext} ctx Контекст бота
   * @param {number} winScore Выбранное количество побед
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleWinScoreSelection(
    ctx: BotContext,
    winScore: number,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'winScore',
    );

    if (!hasStep) return false;

    if (!this.isAllowedWinScore(winScore)) {
      await this.renderer.showIncorrectWinScore(ctx);

      return true;
    }

    const state = this.stateStore.update(userId, {
      step: 'tables',
      data: {
        tournament: {
          winScore,
        },
        tables: [],
      },
    });

    if (
      state.step !== 'tables' ||
      state.data.tournament?.winScore !== winScore ||
      state.data.tables?.length !== 0
    ) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    if (state.data.venue?.id === undefined) {
      this.stateStore.clear(userId);

      await this.renderer.showVenueMissing(ctx);

      return false;
    }

    const venueTables = await getTablesByVenue(state.data.venue.id);

    await ctx.answerCallbackQuery();

    await this.renderer.showTablesStep(ctx, venueTables, [], winScore);

    return true;
  }

  /**
   * Обработка события выбора стола для создаваемого турнира
   *
   * @param {BotContext} ctx Контекст бота
   * @param {UUID} tableId Идентификатор стола
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleTableSelectionToggle(
    ctx: BotContext,
    tableId: UUID,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'tables',
    );

    if (!hasStep) return false;

    let state = this.stateStore.getOrThrow(userId);

    if (state.data.venue?.id === undefined) {
      this.stateStore.clear(userId);

      await this.renderer.showVenueMissing(ctx);

      return false;
    }

    const venueTables = await getTablesByVenue(state.data.venue.id);

    const venueTablesDictionary = new Map(
      venueTables.map((table) => [table.id, table]),
    );

    if (!venueTablesDictionary.has(tableId)) {
      await this.renderer.showInvalidTableSelection(ctx);

      return true;
    }

    const selectedTableIds = new Set(
      state.data.tables?.map((table) => table.id) ?? [],
    );

    if (selectedTableIds.has(tableId)) {
      selectedTableIds.delete(tableId);
    } else {
      selectedTableIds.add(tableId);
    }

    state = this.stateStore.update(userId, {
      step: 'venue',
      data: {
        tables: venueTables.filter((table) => selectedTableIds.has(table.id)),
      },
    });

    if (
      state.step !== 'tables' ||
      state.data.tables?.length !== selectedTableIds.size
    ) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    await ctx.answerCallbackQuery();

    await this.renderer.showTablesStep(ctx, venueTables, [...selectedTableIds]);

    return true;
  }

  async handleTableSelectionFinalize(
    ctx: BotContext,
    isSkip: boolean,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'tables',
    );

    if (!hasStep) return false;

    await ctx.answerCallbackQuery();

    const state = this.stateStore.getOrThrow(userId);

    if (!this.hasRequiredCreationData(state.data)) {
      this.stateStore.clear(userId);

      await this.renderer.showCorruptedSession(ctx);

      return false;
    }

    try {
      await createTournamentDraft({
        venueId: state.data.venue.id,

        name: state.data.tournament.name,
        discipline: state.data.tournament.discipline,
        format: state.data.tournament.format,
        maxParticipants: state.data.tournament.maxParticipants,
        winScore: state.data.tournament.winScore,
        startDate: state.data.tournament.startDate ?? null,

        tableIds: isSkip ? [] : state.data.tables.map((table) => table.id),

        createdBy: ctx.dbUser.id,
      });

      this.stateStore.clear(userId);

      await this.renderer.showCreationSuccess(ctx, state.data);
    } catch (error) {
      await this.renderer.showCreationError(ctx, error);
    }

    return true;
  }

  private getUserId(ctx: BotContext): number | null {
    return ctx.from?.id ?? null;
  }

  private async getUserIfOnCreationStep(
    ctx: BotContext,
    step: ICreationStep,
    isReturnAnswer = true,
  ): Promise<
    { status: false; userId?: never } | { status: true; userId: number }
  > {
    const userId = this.getUserId(ctx);

    if (!userId) return { status: false };

    if (!this.stateStore.hasStep(userId, step)) {
      if (isReturnAnswer) {
        await this.renderer.showSessionExpired(ctx);
      }

      return { status: false };
    }

    return { status: true, userId };
  }

  private isDiscipline(value: string): value is ITournamentDiscipline {
    return Object.values<string>(disciplines).includes(value);
  }

  private isTournamentFormat(value: string): value is ITournamentFormat {
    return Object.values<string>(formats).includes(value);
  }

  private isAllowedParticipantsCount(
    value: number,
  ): value is ITournamentMaxParticipants {
    return Object.values<number>(maxParticipants).includes(value);
  }

  private isAllowedWinScore(value: number): value is ITournamentWinScore {
    return Object.values<number>(winScores).includes(value);
  }

  private hasRequiredCreationData(
    data: ICreationData,
  ): data is IRequiredCreationData {
    const isValidVenue =
      data.venue?.id !== undefined && data.venue?.name !== undefined;

    const isValidTournament =
      data.tournament?.name !== undefined &&
      data.tournament?.discipline !== undefined &&
      data.tournament?.format !== undefined &&
      data.tournament?.maxParticipants !== undefined &&
      data.tournament?.winScore !== undefined;

    const isValidTables = Array.isArray(data.tables);

    return isValidVenue && isValidTournament && isValidTables;
  }
}

// #endregion
