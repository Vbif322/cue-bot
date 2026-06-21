import type { UUID } from 'crypto';

import {
  disciplines,
  maxParticipants,
  formats,
  scheduleModes,
  validMergeRoundsForSize,
  visibilities,
  winScores,
  groupDraws,
  groupsCountOptions,
  participantsPerGroupOptions,
  qualifiersOptionsForGroupSize,
} from '@/db/schema.js';
import { getVenue, getVenues } from '@/services/venueService.js';
import { getTablesByVenue } from '@/services/tableService.js';
import { createTournamentDraft } from '@/services/tournamentService.js';
import type { IDateTimeHelper } from '@/utils/dateTimeHelper.js';
import type {
  ITournamentDiscipline,
  ITournamentMaxParticipants,
  ITournamentFormat,
  ITournamentScheduleMode,
  ITournamentVisibility,
  ITournamentWinScore,
  IGroupDraw,
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

  cancelCreation(userId: number): Promise<boolean>;

  getCreationState(userId: number): Promise<ICreationState | undefined>;

  handleNameInput(ctx: BotContext, name: string): Promise<boolean>;

  handleStartDateInput(ctx: BotContext, startDate: string): Promise<boolean>;

  handleVisibilitySelection(
    ctx: BotContext,
    visibility: string,
  ): Promise<boolean>;

  handleScheduleModeSelection(
    ctx: BotContext,
    scheduleMode: string,
  ): Promise<boolean>;

  handleVenueSelection(ctx: BotContext, venueId: UUID): Promise<boolean>;

  handleDisciplineSelection(
    ctx: BotContext,
    discipline: string,
  ): Promise<boolean>;

  handleFormatSelection(ctx: BotContext, format: string): Promise<boolean>;

  handleRandomModeSelection(
    ctx: BotContext,
    randomAdvancement: boolean,
  ): Promise<boolean>;

  handleMaxParticipantsSelection(
    ctx: BotContext,
    maxParticipants: number,
  ): Promise<boolean>;

  handleMergeRoundSelection(
    ctx: BotContext,
    mergeRound: number,
  ): Promise<boolean>;

  handleGroupsCountSelection(
    ctx: BotContext,
    groupsCount: number,
  ): Promise<boolean>;

  handleParticipantsPerGroupSelection(
    ctx: BotContext,
    participantsPerGroup: number,
  ): Promise<boolean>;

  handleQualifiersPerGroupSelection(
    ctx: BotContext,
    qualifiersPerGroup: number,
  ): Promise<boolean>;

  handleGroupDrawSelection(ctx: BotContext, draw: string): Promise<boolean>;

  handleWinScoreSelection(ctx: BotContext, winScore: number): Promise<boolean>;

  handleTableSelectionToggle(ctx: BotContext, tableId: UUID): Promise<boolean>;

  handleTableSelectAll(ctx: BotContext): Promise<boolean>;

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

    await this.stateStore.start(userId);

    await this.renderer.showNameStep(ctx);
  }

  /**
   * Отмена создания турнира для пользователя
   *
   * @param {number} userId Идентификатор пользователя
   *
   * @returns {boolean} true, если создание было отменено, в противном случае — false
   */
  async cancelCreation(userId: number): Promise<boolean> {
    return this.stateStore.clear(userId);
  }

  /**
   * Получение состояния создания турнира для пользователя
   *
   * @param {number} userId ID пользователя
   *
   * @returns {ICreationState | undefined} Состояние создания или undefined, если сессия не найдена
   */
  async getCreationState(
    userId: number,
  ): Promise<ICreationState | undefined> {
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

    const state = await this.stateStore.update(userId, {
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

    const state = await this.stateStore.update(userId, {
      step: 'visibility',
      data: {
        tournament: {
          startDate: parsedDate.datetime,
        },
      },
    });

    if (
      state.step !== 'visibility' ||
      state.data.tournament?.startDate?.toISOString() !==
        parsedDate.datetime.toISOString()
    ) {
      return false;
    }

    await this.renderer.showVisibilityStep(ctx, parsedDate.datetime);

    return true;
  }

  /**
   * Обрабатывает выбор видимости турнира пользователем
   *
   * Переводит процесс на шаг выбора площадки (загружает площадки).
   *
   * @param {BotContext} ctx Контекст бота
   * @param {string} visibility Выбранная видимость турнира
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleVisibilitySelection(
    ctx: BotContext,
    visibility: string,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'visibility',
    );

    if (!hasStep) return false;

    if (!this.isVisibility(visibility)) {
      await this.renderer.showInvalidVisibility(ctx);

      return true;
    }

    const state = await this.stateStore.update(userId, {
      step: 'scheduleMode',
      data: {
        tournament: {
          visibility,
        },
      },
    });

    if (
      state.step !== 'scheduleMode' ||
      state.data.tournament?.visibility !== visibility
    ) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    await ctx.answerCallbackQuery();

    await this.renderer.showScheduleModeStep(ctx, visibility);

    return true;
  }

  /**
   * Обрабатывает выбор режима расписания турнира пользователем
   *
   * Переводит процесс на шаг выбора площадки (загружает площадки).
   *
   * @param {BotContext} ctx Контекст бота
   * @param {string} scheduleMode Выбранный режим расписания
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleScheduleModeSelection(
    ctx: BotContext,
    scheduleMode: string,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'scheduleMode',
    );

    if (!hasStep) return false;

    if (!this.isScheduleMode(scheduleMode)) {
      await this.renderer.showInvalidScheduleMode(ctx);

      return true;
    }

    const state = await this.stateStore.update(userId, {
      step: 'venue',
      data: {
        tournament: {
          scheduleMode,
        },
      },
    });

    if (
      state.step !== 'venue' ||
      state.data.tournament?.scheduleMode !== scheduleMode
    ) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    const venues = await getVenues();

    if (venues.length === 0) {
      await this.stateStore.clear(userId);

      await this.renderer.showNoVenues(ctx);

      return false;
    }

    await ctx.answerCallbackQuery();

    await this.renderer.showVenueStep(ctx, scheduleMode, venues);

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

    const state = await this.stateStore.update(userId, {
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

    const state = await this.stateStore.update(userId, {
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

    // Groups + playoff: random advancement is irrelevant, and the participant
    // cap is derived from the group config — so skip both the random-mode and
    // max-participants steps and collect the group config instead.
    if (format === 'groups_playoff') {
      const state = await this.stateStore.update(userId, {
        step: 'groupsCount',
        data: {
          tournament: {
            format,
            randomAdvancement: false,
          },
        },
      });

      if (
        state.step !== 'groupsCount' ||
        state.data.tournament?.format !== format
      ) {
        await this.renderer.showSavedStateError(ctx);

        return false;
      }

      await ctx.answerCallbackQuery();

      await this.renderer.showGroupsCountStep(ctx);

      return true;
    }

    // Random pairing is only meaningful for elimination brackets. Round-robin
    // skips the random-mode step entirely and pins the flag to false.
    if (format === 'round_robin') {
      const state = await this.stateStore.update(userId, {
        step: 'maxParticipants',
        data: {
          tournament: {
            format,
            randomAdvancement: false,
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

    const state = await this.stateStore.update(userId, {
      step: 'randomMode',
      data: {
        tournament: {
          format,
        },
      },
    });

    if (
      state.step !== 'randomMode' ||
      state.data.tournament?.format !== format
    ) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    await ctx.answerCallbackQuery();

    await this.renderer.showRandomModeStep(ctx, format);

    return true;
  }

  /**
   * Обрабатывает выбор режима случайных пар (рандом) пользователем
   *
   * @param {BotContext} ctx Контекст бота
   * @param {boolean} randomAdvancement Включён ли режим случайных пар
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleRandomModeSelection(
    ctx: BotContext,
    randomAdvancement: boolean,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'randomMode',
    );

    if (!hasStep) return false;

    const state = await this.stateStore.update(userId, {
      step: 'maxParticipants',
      data: {
        tournament: {
          randomAdvancement,
        },
      },
    });

    if (
      state.step !== 'maxParticipants' ||
      state.data.tournament?.randomAdvancement !== randomAdvancement ||
      state.data.tournament.format === undefined
    ) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    await ctx.answerCallbackQuery();

    await this.renderer.showMaxParticipantsStep(
      ctx,
      state.data.tournament.format,
      randomAdvancement,
    );

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

    const current = await this.stateStore.getOrThrow(userId);
    const isDoubleElim =
      current.data.tournament?.format === 'double_elimination';

    // Double elimination has an extra "merge round" sub-step before win score.
    if (isDoubleElim) {
      const state = await this.stateStore.update(userId, {
        step: 'mergeRound',
        data: { tournament: { maxParticipants } },
      });

      if (
        state.step !== 'mergeRound' ||
        state.data.tournament?.maxParticipants !== maxParticipants
      ) {
        await this.renderer.showSavedStateError(ctx);

        return false;
      }

      await ctx.answerCallbackQuery();

      await this.renderer.showMergeRoundStep(ctx, maxParticipants);

      return true;
    }

    const state = await this.stateStore.update(userId, {
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
   * Обрабатывает выбор раунда объединения (для double elimination)
   *
   * @param {BotContext} ctx Контекст бота
   * @param {number} mergeRound Выбранный раунд объединения
   *
   * @returns {Promise<boolean>}
   * Возвращает:
   * - `true`, если ввод был обработан (включая ошибку пользовательского ввода)
   * - `false`, произошла внутренняя ошибка приложения
   */
  async handleMergeRoundSelection(
    ctx: BotContext,
    mergeRound: number,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'mergeRound',
    );

    if (!hasStep) return false;

    const current = await this.stateStore.getOrThrow(userId);
    const maxP = current.data.tournament?.maxParticipants;

    if (maxP === undefined || !this.isAllowedMergeRound(mergeRound, maxP)) {
      await this.renderer.showIncorrectMergeRound(ctx);

      return true;
    }

    const state = await this.stateStore.update(userId, {
      step: 'winScore',
      data: {
        tournament: {
          mergeRound,
        },
      },
    });

    if (
      state.step !== 'winScore' ||
      state.data.tournament?.mergeRound !== mergeRound ||
      state.data.tournament.maxParticipants === undefined
    ) {
      await this.renderer.showSavedStateError(ctx);

      return false;
    }

    await ctx.answerCallbackQuery();

    await this.renderer.showWinScoreStep(
      ctx,
      state.data.tournament.maxParticipants,
    );

    return true;
  }

  /** groups_playoff: choose the number of groups. */
  async handleGroupsCountSelection(
    ctx: BotContext,
    groupsCount: number,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'groupsCount',
    );
    if (!hasStep) return false;

    if (!groupsCountOptions.includes(groupsCount as never)) {
      await this.renderer.showIncorrectGroupsCount(ctx);
      return true;
    }

    const state = await this.stateStore.update(userId, {
      step: 'participantsPerGroup',
      data: { tournament: { groupsCount } },
    });
    if (
      state.step !== 'participantsPerGroup' ||
      state.data.tournament?.groupsCount !== groupsCount
    ) {
      await this.renderer.showSavedStateError(ctx);
      return false;
    }

    await ctx.answerCallbackQuery();
    await this.renderer.showParticipantsPerGroupStep(ctx, groupsCount);
    return true;
  }

  /** groups_playoff: choose the number of participants per group. */
  async handleParticipantsPerGroupSelection(
    ctx: BotContext,
    participantsPerGroup: number,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'participantsPerGroup',
    );
    if (!hasStep) return false;

    if (!participantsPerGroupOptions.includes(participantsPerGroup as never)) {
      await this.renderer.showIncorrectParticipantsPerGroup(ctx);
      return true;
    }

    const state = await this.stateStore.update(userId, {
      step: 'qualifiersPerGroup',
      data: { tournament: { participantsPerGroup } },
    });
    if (
      state.step !== 'qualifiersPerGroup' ||
      state.data.tournament?.participantsPerGroup !== participantsPerGroup
    ) {
      await this.renderer.showSavedStateError(ctx);
      return false;
    }

    await ctx.answerCallbackQuery();
    await this.renderer.showQualifiersPerGroupStep(ctx, participantsPerGroup);
    return true;
  }

  /** groups_playoff: choose how many qualify from each group. */
  async handleQualifiersPerGroupSelection(
    ctx: BotContext,
    qualifiersPerGroup: number,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'qualifiersPerGroup',
    );
    if (!hasStep) return false;

    const current = await this.stateStore.getOrThrow(userId);
    const perGroup = current.data.tournament?.participantsPerGroup;
    if (
      perGroup == null ||
      !qualifiersOptionsForGroupSize(perGroup).includes(qualifiersPerGroup)
    ) {
      await this.renderer.showIncorrectQualifiersPerGroup(ctx);
      return true;
    }

    const state = await this.stateStore.update(userId, {
      step: 'groupDraw',
      data: { tournament: { qualifiersPerGroup } },
    });
    if (
      state.step !== 'groupDraw' ||
      state.data.tournament?.qualifiersPerGroup !== qualifiersPerGroup
    ) {
      await this.renderer.showSavedStateError(ctx);
      return false;
    }

    await ctx.answerCallbackQuery();
    await this.renderer.showGroupDrawStep(ctx, qualifiersPerGroup);
    return true;
  }

  /** groups_playoff: choose the draw mode, derive the participant cap, advance. */
  async handleGroupDrawSelection(
    ctx: BotContext,
    draw: string,
  ): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'groupDraw',
    );
    if (!hasStep) return false;

    if (!this.isGroupDraw(draw)) {
      await this.renderer.showSavedStateError(ctx);
      return false;
    }

    const current = await this.stateStore.getOrThrow(userId);
    const groupsCount = current.data.tournament?.groupsCount;
    const perGroup = current.data.tournament?.participantsPerGroup;
    if (groupsCount == null || perGroup == null) {
      await this.renderer.showSavedStateError(ctx);
      return false;
    }

    // The participant cap for groups_playoff is the full set of group seats.
    const maxParticipants = groupsCount * perGroup;

    const state = await this.stateStore.update(userId, {
      step: 'winScore',
      data: { tournament: { groupDraw: draw, maxParticipants } },
    });
    if (
      state.step !== 'winScore' ||
      state.data.tournament?.groupDraw !== draw ||
      state.data.tournament.maxParticipants !== maxParticipants
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

    const state = await this.stateStore.update(userId, {
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
      await this.stateStore.clear(userId);

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

    let state = await this.stateStore.getOrThrow(userId);

    if (state.data.venue?.id === undefined) {
      await this.stateStore.clear(userId);

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

    state = await this.stateStore.update(userId, {
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

  async handleTableSelectAll(ctx: BotContext): Promise<boolean> {
    const { status: hasStep, userId } = await this.getUserIfOnCreationStep(
      ctx,
      'tables',
    );

    if (!hasStep) return false;

    const state = await this.stateStore.getOrThrow(userId);

    if (state.data.venue?.id === undefined) {
      await this.stateStore.clear(userId);

      await this.renderer.showVenueMissing(ctx);

      return false;
    }

    const venueTables = await getTablesByVenue(state.data.venue.id);

    const allSelected =
      venueTables.length > 0 &&
      venueTables.every((t) => state.data.tables?.some((st) => st.id === t.id));

    await this.stateStore.updateData(userId, {
      tables: allSelected ? [] : venueTables,
    });

    const newSelectedIds = allSelected ? [] : venueTables.map((t) => t.id);

    await ctx.answerCallbackQuery();

    await this.renderer.showTablesStep(ctx, venueTables, newSelectedIds);

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

    const state = await this.stateStore.getOrThrow(userId);

    if (!this.hasRequiredCreationData(state.data)) {
      await this.stateStore.clear(userId);

      await this.renderer.showCorruptedSession(ctx);

      return false;
    }

    try {
      const created = await createTournamentDraft({
        venueId: state.data.venue.id,

        name: state.data.tournament.name,
        discipline: state.data.tournament.discipline,
        format: state.data.tournament.format,
        randomAdvancement: state.data.tournament.randomAdvancement,
        visibility: state.data.tournament.visibility,
        scheduleMode: state.data.tournament.scheduleMode,
        maxParticipants: state.data.tournament.maxParticipants,
        winScore: state.data.tournament.winScore,
        mergeRound: state.data.tournament.mergeRound ?? 2,
        groupsCount: state.data.tournament.groupsCount ?? null,
        participantsPerGroup: state.data.tournament.participantsPerGroup ?? null,
        qualifiersPerGroup: state.data.tournament.qualifiersPerGroup ?? null,
        groupDraw: state.data.tournament.groupDraw ?? null,
        startDate: state.data.tournament.startDate ?? null,

        tableIds: isSkip ? [] : state.data.tables.map((table) => table.id),

        createdBy: ctx.dbUser.id,
      });

      // Write the new id back into state so the success screen and its
      // "Открыть регистрацию" button reference the real tournament (the button
      // callback is tournament_open_reg:<id>, which crashed with `undefined`).
      state.data.tournament.id = created.id;

      await this.stateStore.clear(userId);

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

    if (!await this.stateStore.hasStep(userId, step)) {
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

  private isVisibility(value: string): value is ITournamentVisibility {
    return Object.values<string>(visibilities).includes(value);
  }

  private isScheduleMode(value: string): value is ITournamentScheduleMode {
    return Object.values<string>(scheduleModes).includes(value);
  }

  private isAllowedParticipantsCount(
    value: number,
  ): value is ITournamentMaxParticipants {
    return Object.values<number>(maxParticipants).includes(value);
  }

  private isAllowedWinScore(value: number): value is ITournamentWinScore {
    return Object.values<number>(winScores).includes(value);
  }

  private isAllowedMergeRound(value: number, maxParticipants: number): boolean {
    return validMergeRoundsForSize(maxParticipants).includes(value);
  }

  private isGroupDraw(value: string): value is IGroupDraw {
    return Object.values<string>(groupDraws).includes(value);
  }

  private hasRequiredCreationData(
    data: ICreationData,
  ): data is IRequiredCreationData {
    const isValidVenue = data.venue !== undefined;

    const isValidTournament =
      data.tournament?.name !== undefined &&
      data.tournament.visibility !== undefined &&
      data.tournament.scheduleMode !== undefined &&
      data.tournament.discipline !== undefined &&
      data.tournament.format !== undefined &&
      data.tournament.randomAdvancement !== undefined &&
      data.tournament.maxParticipants !== undefined &&
      data.tournament.winScore !== undefined;

    // groups_playoff additionally needs the full group config.
    const isValidGroupConfig =
      data.tournament?.format !== 'groups_playoff' ||
      (data.tournament.groupsCount != null &&
        data.tournament.participantsPerGroup != null &&
        data.tournament.qualifiersPerGroup != null &&
        data.tournament.groupDraw != null);

    const isValidTables = Array.isArray(data.tables);

    return (
      isValidVenue && isValidTournament && isValidGroupConfig && isValidTables
    );
  }
}

// #endregion
