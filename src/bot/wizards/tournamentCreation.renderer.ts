import { InlineKeyboard } from 'grammy';

import { DISCIPLINE_LABELS, FORMAT_LABELS } from '@/utils/constants.js';
import { safeEditMessageText } from '@/utils/messageHelpers.js';
import { formatDate } from '@/utils/dateHelpers.js';
import type {
  IDiscipline,
  ITournamentFormat,
} from '@/db/schema/tournaments.js';

import { STEPS_COUNT } from './tournamentCreation.const.js';
import type { BotContext } from '../types.js';
import type {
  ITournamentCreationKeyboards,
  IVenueList,
} from './tournamentCreation.keyboards.js';
import type { ICreationState } from './tournamentCreation.js';
import type { Tournament } from '../@types/tournament.js';
import type { Venue } from '../@types/venue.js';
import type { Table } from '../@types/table.js';

// #region Types / Interfaces

export interface ITournamentCreationRenderer {
  showNameStep(ctx: BotContext): Promise<void>;
  showDateStep(ctx: BotContext, name: string): Promise<void>;
  showVenueStep(
    ctx: BotContext,
    startDate: Date,
    venues: Array<{ id: string; name: string }>,
  ): Promise<void>;
  showDisciplineStep(ctx: BotContext, venueName: string): Promise<void>;
  showFormatStep(
    ctx: BotContext,
    selectedDiscipline: IDiscipline,
  ): Promise<void>;
  showMaxParticipantsStep(
    ctx: BotContext,
    selectedFormat: ITournamentFormat,
  ): Promise<void>;
  showWinScoreStep(ctx: BotContext, participants: number): Promise<void>;
  showTablesStep(
    ctx: BotContext,
    params: IRenderTablesStepParams,
  ): Promise<void>;

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
    params: IRenderSuccessParams,
  ): Promise<void>;
  showCreationError(ctx: BotContext, error: unknown): Promise<void>;
}

interface IRenderTablesStepParams {
  state: ICreationState;

  tables: Array<{
    id: string;
    name: string;
  }>;
}

interface IRenderSuccessParams {
  venue: Pick<Venue, 'name'>;

  tournament: Pick<
    Tournament,
    | 'id'
    | 'name'
    | 'startDate'
    | 'discipline'
    | 'format'
    | 'maxParticipants'
    | 'winScore'
  >;

  tableIds: Pick<Table, 'id'>[];
}

// #endregion

// #region Class

/** Отвечает за отображение шагов мастера создания турнира */
export class TournamentCreationRenderer implements ITournamentCreationRenderer {
  constructor(private readonly keyboards: ITournamentCreationKeyboards) {}

  async showNameStep(ctx: BotContext): Promise<void> {
    await ctx.reply(`Шаг 1/${STEPS_COUNT}: Введите название турнира:`);
  }

  async showDateStep(ctx: BotContext, name: string): Promise<void> {
    await ctx.reply(
      `Название: ${name}\n\n` + `Шаг 2/${STEPS_COUNT}: Введите дату турнира:`,
    );
  }

  async showVenueStep(
    ctx: BotContext,
    startDate: Date,
    venues: IVenueList,
  ): Promise<void> {
    await ctx.reply(
      `Дата: ${formatDate(startDate)}\n\n` +
        `Шаг 3/${STEPS_COUNT}: Выберите площадку:`,
      {
        reply_markup: this.keyboards.buildVenuesKeyboard(venues),
      },
    );
  }

  async showDisciplineStep(ctx: BotContext, venueName: string): Promise<void> {
    await safeEditMessageText(ctx, {
      text:
        `Площадка: ${venueName}\n\n` +
        `Шаг 4/${STEPS_COUNT}: Выберите дисциплину:`,
      reply_markup: this.keyboards.buildDisciplineKeyboard(),
    });
  }

  async showFormatStep(
    ctx: BotContext,
    selectedDiscipline: IDiscipline,
  ): Promise<void> {
    await safeEditMessageText(ctx, {
      text:
        `Дисциплина: ${DISCIPLINE_LABELS[selectedDiscipline] ?? selectedDiscipline}\n\n` +
        `Шаг 5/${STEPS_COUNT}: Выберите формат турнира:`,
      reply_markup: this.keyboards.buildFormatKeyboard(),
    });
  }

  async showMaxParticipantsStep(
    ctx: BotContext,
    selectedFormat: ITournamentFormat,
  ): Promise<void> {
    await safeEditMessageText(ctx, {
      text:
        `Формат: ${FORMAT_LABELS[selectedFormat] ?? selectedFormat}\n\n` +
        `Шаг 6/${STEPS_COUNT}: Выберите максимальное количество участников:`,
      reply_markup: this.keyboards.buildParticipantsKeyboard(),
    });
  }

  async showWinScoreStep(ctx: BotContext, participants: number): Promise<void> {
    await safeEditMessageText(ctx, {
      text:
        `Участников: ${participants}\n\n` +
        `Шаг 7/${STEPS_COUNT}: До скольки побед играть?`,
      reply_markup: this.keyboards.buildWinScoreKeyboard(),
    });
  }

  async showTablesStep(
    ctx: BotContext,
    params: IRenderTablesStepParams,
  ): Promise<void> {
    const { state, tables } = params;

    const venueName = state.data.venue?.name ?? '—';
    const winScore = state.data.tournament?.winScore ?? '—';

    const tablesCount = (state.data.tableIds ?? []).length;

    if (tables.length === 0) {
      await safeEditMessageText(ctx, {
        text:
          `До побед: ${winScore}\n` +
          `Площадка: ${venueName}\n\n` +
          `Шаг 8/${STEPS_COUNT}: У выбранной площадки нет столов.\n` +
          `Можно завершить создание турнира без привязки столов.`,
        reply_markup: new InlineKeyboard().text('Пропустить', 'tables_skip'),
      });

      return;
    }

    await safeEditMessageText(ctx, {
      text:
        `До побед: ${winScore}\n` +
        `Площадка: ${venueName}\n\n` +
        `Шаг 8/${STEPS_COUNT}: Выберите столы этой площадки или пропустите шаг.\n` +
        `Выбрано столов: ${selectedTablesCount}`,
      reply_markup: this.keyboards.buildTablesKeyboard(
        tables,
        selectedTableIds,
      ),
    });
  }

  async showSessionExpired(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery('Сессия создания истекла');
  }

  async showVenueNotFound(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: 'Площадка не найдена',
      show_alert: true,
    });
  }

  async showInvalidDiscipline(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: 'Некорректная дисциплина',
      show_alert: true,
    });
  }

  async showInvalidFormat(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: 'Некорректный формат турнира',
      show_alert: true,
    });
  }

  async showVenueMissing(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: 'Площадка не выбрана',
      show_alert: true,
    });
  }

  async showInvalidTableSelection(ctx: BotContext): Promise<void> {
    await ctx.answerCallbackQuery({
      text: 'Можно выбрать только столы выбранной площадки',
      show_alert: true,
    });
  }

  async showInvalidName(ctx: BotContext): Promise<void> {
    await ctx.reply('Название должно быть минимум 3 символа.');
  }

  async showInvalidDate(ctx: BotContext): Promise<void> {
    await ctx.reply('Не удалось распознать дату, попробуйте еще раз');
  }

  async showNoVenues(ctx: BotContext): Promise<void> {
    await ctx.reply('Нельзя создать турнир: в системе нет ни одной площадки.');
  }

  async showCorruptedSession(ctx: BotContext): Promise<void> {
    await safeEditMessageText(ctx, {
      text: 'Сессия создания повреждена. Начните создание турнира заново.',
    });
  }

  async showCreationSuccess(
    ctx: BotContext,
    params: IRenderSuccessParams,
  ): Promise<void> {
    const { tournament, selectedTablesCount } = params;

    const keyboard = new InlineKeyboard()
      .text('Открыть регистрацию', `tournament_open_reg:${tournament.id}`)
      .row();

    const formattedStartDate = tournament.startDate
      ? formatDate(tournament.startDate)
      : '—';

    await safeEditMessageText(ctx, {
      text:
        `✅ Турнир создан!\n\n` +
        `Название: ${tournament.name}\n` +
        `Дата начала: ${formattedStartDate}\n` +
        `Площадка: ${tournament.venueName ?? '—'}\n` +
        `Дисциплина: ${DISCIPLINE_LABELS[tournament.discipline] ?? tournament.discipline}\n` +
        `Формат: ${FORMAT_LABELS[tournament.format] ?? tournament.format}\n` +
        `Участников: ${tournament.maxParticipants}\n` +
        `До побед: ${tournament.winScore}\n` +
        `Столов выбрано: ${selectedTablesCount}\n` +
        `Статус: Черновик\n\n` +
        `ID: \`${tournament.id}\``,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  async showCreationError(ctx: BotContext, error: unknown): Promise<void> {
    await safeEditMessageText(ctx, {
      text:
        `❌ Ошибка при создании турнира:\n` +
        `${error instanceof Error ? error.message : 'Неизвестная ошибка'}`,
    });
  }
}

// #endregion
