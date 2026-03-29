import { formatDiscipline, formatFormat } from '@/utils/constants.js';
import { safeEditMessageText } from '@/utils/messageHelpers.js';
import type { IDateTimeHelper } from '@/utils/dateTimeHelper.js';

import { STEPS_COUNT } from './tournamentCreation.const.js';
import { getMatchStatusEmoji } from '../ui/matchUI.js';
import type { BotContext } from '../types.js';
import type { ITournamentCreationKeyboards } from './tournamentCreation.keyboards.js';
import type { IRequiredCreationData } from './tournamentCreation.js';
import type { Tournament } from '../@types/tournament.js';
import type { Venue } from '../@types/venue.js';
import type { Table } from '../@types/table.js';

// #region Types / Interfaces

export interface ITournamentCreationRenderer {
  showNameStep(ctx: BotContext): Promise<void>; // Step 1
  showStartDateStep(ctx: BotContext, name: Tournament['name']): Promise<void>; // Step 2
  showVenueStep(
    ctx: BotContext,
    startDate: Tournament['startDate'],
    venues: Array<Pick<Venue, 'id' | 'name'>>,
  ): Promise<void>; // Step 3
  showDisciplineStep(ctx: BotContext, venueName: Venue['name']): Promise<void>; // Step 4
  showFormatStep(
    ctx: BotContext,
    discipline: Tournament['discipline'],
  ): Promise<void>; // Step 5
  showMaxParticipantsStep(
    ctx: BotContext,
    format: Tournament['format'],
  ): Promise<void>; // Step 6
  showWinScoreStep(
    ctx: BotContext,
    maxParticipants: Tournament['maxParticipants'],
  ): Promise<void>; // Step 7
  showTablesStep(
    ctx: BotContext,
    tables: Array<Pick<Table, 'id' | 'name'>>,
    selectedTableIds: string[],
    winScore?: Tournament['winScore'],
  ): Promise<void>; // Step 8

  showSessionExpired(ctx: BotContext): Promise<void>;
  showVenueNotFound(ctx: BotContext): Promise<void>;
  showInvalidDiscipline(ctx: BotContext): Promise<void>;
  showInvalidFormat(ctx: BotContext): Promise<void>;
  showVenueMissing(ctx: BotContext): Promise<void>;
  showInvalidTableSelection(ctx: BotContext): Promise<void>;
  showInvalidName(ctx: BotContext): Promise<void>;
  showInvalidDate(ctx: BotContext): Promise<void>;
  showNoVenues(ctx: BotContext): Promise<void>;
  showCorruptedSession(ctx: BotContext): Promise<void>;

  showCreationSuccess(
    ctx: BotContext,
    data: IRequiredCreationData,
  ): Promise<void>;
  showCreationError(ctx: BotContext, error: unknown): Promise<void>;
}

// #endregion

// #region Class

/** Отображение шагов мастера создания турнира */
export class TournamentCreationRenderer implements ITournamentCreationRenderer {
  constructor(
    private readonly keyboards: ITournamentCreationKeyboards,
    private readonly dateTimeHelper: IDateTimeHelper,
  ) {}

  async showNameStep(ctx: BotContext): Promise<void> {
    const message = `
    Шаг 1 / ${STEPS_COUNT}
    Введите название турнира
    `.trim();

    await ctx.reply(message);
  }

  async showStartDateStep(
    ctx: BotContext,
    name: Tournament['name'],
  ): Promise<void> {
    const resultMessage = `
    Установлено название турнира: ${name}
    `;

    await safeEditMessageText(ctx, {
      text: resultMessage,
    });

    const message = `
    Шаг 2 / ${STEPS_COUNT}
    Введите дату турнира
    `.trim();

    await ctx.reply(message);
  }

  async showVenueStep(
    ctx: BotContext,
    startDate: Tournament['startDate'],
    venues: Array<Pick<Venue, 'id' | 'name'>>,
  ): Promise<void> {
    const resultMessage = `
    Установлена дата турнира: ${this.dateTimeHelper.formatDate(startDate)}
    `;

    await safeEditMessageText(ctx, {
      text: resultMessage,
    });

    const message = `
    Шаг 3 / ${STEPS_COUNT}
    Выберите площадку
    `.trim();

    await ctx.reply(message, {
      reply_markup: this.keyboards.buildVenuesKeyboard(venues),
    });
  }

  async showDisciplineStep(
    ctx: BotContext,
    venueName: Venue['name'],
  ): Promise<void> {
    const resultMessage = `
    Установлена площадка: ${venueName}
    `;

    await safeEditMessageText(ctx, {
      text: resultMessage,
    });

    const message = `
    Шаг 4 / ${STEPS_COUNT}
    Выберите дисциплину
    `.trim();

    await ctx.reply(message, {
      reply_markup: this.keyboards.buildDisciplineKeyboard(),
    });
  }

  async showFormatStep(
    ctx: BotContext,
    discipline: Tournament['discipline'],
  ): Promise<void> {
    const resultMessage = `
    Установлена дисциплина: ${formatDiscipline(discipline)}
    `;

    await safeEditMessageText(ctx, {
      text: resultMessage,
    });

    const message = `
    Шаг 5 / ${STEPS_COUNT}
    Выберите формат турнира
    `.trim();

    await ctx.reply(message, {
      reply_markup: this.keyboards.buildFormatKeyboard(),
    });
  }

  async showMaxParticipantsStep(
    ctx: BotContext,
    format: Tournament['format'],
  ): Promise<void> {
    const resultMessage = `
    Установленный формат: ${formatFormat(format)}
    `;

    await safeEditMessageText(ctx, {
      text: resultMessage,
    });

    const message = `
    Шаг 6 / ${STEPS_COUNT}
    Введите максимальное количество участников
    `.trim();

    await ctx.reply(message, {
      reply_markup: this.keyboards.buildParticipantsKeyboard(),
    });
  }

  async showWinScoreStep(
    ctx: BotContext,
    maxParticipants: Tournament['maxParticipants'],
  ): Promise<void> {
    const resultMessage = `
    Установленное максимальное количество участников: ${maxParticipants}
    `;

    await safeEditMessageText(ctx, {
      text: resultMessage,
    });

    const message = `
    Шаг 7 / ${STEPS_COUNT}
    Введите количество побед при которых игра будет завершена
    `.trim();

    await ctx.reply(message, {
      reply_markup: this.keyboards.buildWinScoreKeyboard(),
    });
  }

  async showTablesStep(
    ctx: BotContext,
    tables: Array<Pick<Table, 'id' | 'name'>>,
    selectedTableIds: string[],
    winScore?: Tournament['winScore'],
  ): Promise<void> {
    if (winScore !== undefined) {
      const resultMessage = `Установленное количество побед: ${winScore}`;

      await safeEditMessageText(ctx, {
        text: resultMessage,
      });
    }

    if (tables.length === 0) {
      const message = `
      Шаг 8 / ${STEPS_COUNT}
      У выбранной площадки нет столов
      `.trim();

      await safeEditMessageText(ctx, {
        text: message,
        reply_markup: this.keyboards.buildTablesSkipOnlyKeyboard(),
      });

      return;
    }

    const message = `
    Шаг 8 / ${STEPS_COUNT}
    Выберите столы для турнира на этой площадке или пропустите шаг
    `.trim();

    await safeEditMessageText(ctx, {
      text: message,
      reply_markup: this.keyboards.buildTablesKeyboard(
        tables,
        selectedTableIds,
      ),
    });
  }

  async showSessionExpired(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: `${getMatchStatusEmoji('cancelled')} Сессия создания истекла`,
      show_alert: true,
    });
  }

  async showVenueNotFound(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: `${getMatchStatusEmoji('cancelled')} Площадка не найдена`,
      show_alert: true,
    });
  }

  async showInvalidDiscipline(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: `${getMatchStatusEmoji('cancelled')} Некорректная дисциплина`,
      show_alert: true,
    });
  }

  async showInvalidFormat(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: `${getMatchStatusEmoji('cancelled')} Некорректный формат турнира`,
      show_alert: true,
    });
  }

  async showVenueMissing(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: `${getMatchStatusEmoji('cancelled')} Площадка не выбрана`,
      show_alert: true,
    });
  }

  async showInvalidTableSelection(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: `${getMatchStatusEmoji('cancelled')} Можно выбрать только столы выбранной площадки`,
      show_alert: true,
    });
  }

  async showInvalidName(ctx: BotContext): Promise<void> {
    await ctx.reply(
      `${getMatchStatusEmoji('cancelled')} Название должно быть минимум 3 символа.`,
    );
  }

  async showInvalidDate(ctx: BotContext): Promise<void> {
    await ctx.reply(
      `${getMatchStatusEmoji('cancelled')} Не удалось распознать дату, попробуйте еще раз`,
    );
  }

  async showNoVenues(ctx: BotContext): Promise<void> {
    await ctx.reply(
      `${getMatchStatusEmoji('cancelled')} Невозможно создать турнир: в системе нет ни одной площадки`,
    );
  }

  async showCorruptedSession(ctx: BotContext): Promise<void> {
    await safeEditMessageText(ctx, {
      text: `${getMatchStatusEmoji('cancelled')} Сессия создания повреждена. Начните создание турнира заново!`,
    });
  }

  async showCreationSuccess(
    ctx: BotContext,
    data: IRequiredCreationData,
  ): Promise<void> {
    const completeMessage = `
    ${getMatchStatusEmoji('completed')} Турнир создан!
    `.trim();

    await ctx.reply(completeMessage);

    const { venue, tournament, tables } = data;

    const formattedStartDate =
      tournament.startDate !== null
        ? this.dateTimeHelper.formatDate(tournament.startDate)
        : '—';

    const formattedDiscipline = formatDiscipline(tournament.discipline);

    const formattedFormat = formatFormat(tournament.format);

    const message = `
    Данные турнира:
    - ID: ${tournament.id}
    - Название: ${tournament.name}
    - Статус: Черновик
    - Дата начала: ${formattedStartDate}
    - Площадка: ${venue.name}
    - Дисциплина: ${formattedDiscipline}
    - Формат: ${formattedFormat}
    - Участников: ${tournament.maxParticipants}
    - Количество необходимых побед: ${tournament.winScore}
    - Количество выбранных столов: ${tables.length}
    `.trim();

    await safeEditMessageText(ctx, {
      text: message,
      parse_mode: 'Markdown',
      reply_markup: this.keyboards.buildTournamentCreatedKeyboard(
        tournament.id,
      ),
    });
  }

  async showCreationError(ctx: BotContext, error: unknown): Promise<void> {
    await safeEditMessageText(ctx, {
      text:
        `${getMatchStatusEmoji('cancelled')} Ошибка при создании турнира:\n` +
        `${error instanceof Error ? error.message : 'Неизвестная ошибка'}`,
    });
  }
}

// #endregion
