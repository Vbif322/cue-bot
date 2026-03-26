import { Composer, InlineKeyboard } from 'grammy';
import { discipline, tournamentFormat } from '../../db/schema.js';
import { parseDate, formatDate } from '../../utils/dateHelpers.js';
import { DISCIPLINE_LABELS, FORMAT_LABELS } from '../../utils/constants.js';
import { safeEditMessageText } from '../../utils/messageHelpers.js';
import { createTournamentDraft } from '../../services/tournamentService.js';
import { getVenue, getVenues } from '../../services/venueService.js';
import { getTablesByVenue } from '../../services/tableService.js';

import type { BotContext } from '../types.js';

const STEPS_COUNT = 8;

type CreationStep =
  | 'name'
  | 'date'
  | 'venue'
  | 'discipline'
  | 'format'
  | 'maxParticipants'
  | 'winScore'
  | 'tables';

interface CreationData {
  venueId?: string;
  venueName?: string;

  name?: string;
  discipline?: string;
  format?: string;
  maxParticipants?: number;
  winScore?: number;
  startDate?: Date;

  selectedTableIds?: string[];
}

interface CreationState {
  step: CreationStep;
  lastMessageId?: number;
  data: CreationData;
}

// TODO: Replace with database-backed sessions for production
// This in-memory storage will be lost on bot restart
const creationState = new Map<number, CreationState>();

export const tournamentCreationWizard = new Composer<BotContext>();

/**
 * Start tournament creation wizard
 */
export function startCreationWizard(userId: number, messageId: number): void {
  creationState.set(userId, {
    step: 'name',
    lastMessageId: messageId,
    data: {},
  });
}

/**
 * Cancel tournament creation
 */
export function cancelCreation(userId: number): boolean {
  return creationState.delete(userId);
}

/**
 * Get creation state for user
 */
export function getCreationState(userId: number): CreationState | undefined {
  return creationState.get(userId);
}

// === STEP HANDLERS ===

/**
 * Handle name input (Step 1)
 */
export async function handleNameInput(
  ctx: BotContext,
  text: string,
): Promise<boolean> {
  const userId = ctx.from!.id;
  const state = creationState.get(userId);

  if (!state || state.step !== 'name') {
    return false;
  }

  if (text.length < 3) {
    await ctx.reply('Название должно быть минимум 3 символа.');

    return true;
  }

  state.data.name = text;
  state.step = 'date';

  await ctx.reply(
    `Название: ${text}\n\nШаг 2/${STEPS_COUNT}: Введите дату турнира:`,
  );

  return true;
}

/**
 * Handle date input (Step 2)
 */
export async function handleDateInput(
  ctx: BotContext,
  text: string,
): Promise<boolean> {
  const userId = ctx.from!.id;
  const state = creationState.get(userId);

  if (!state || state.step !== 'date') {
    return false;
  }

  const parsedDate = parseDate(text);

  if (!parsedDate) {
    await ctx.reply('Не удалось распознать дату, попробуйте еще раз');

    return true;
  }

  const venues = await getVenues();

  if (venues.length === 0) {
    creationState.delete(userId);

    await ctx.reply('Нельзя создать турнир: в системе нет ни одной площадки.');

    return true;
  }

  state.data.startDate = parsedDate;
  state.step = 'venue';

  await ctx.reply(
    `Дата: ${formatDate(parsedDate)}\n\nШаг 3/${STEPS_COUNT}: Выберите площадку:`,
    {
      reply_markup: buildVenuesKeyboard(venues),
    },
  );
  return true;
}

/**
 * Handle venue selection (Step 3)
 */
export async function handleVenueSelection(
  ctx: BotContext,
  venueId: string,
): Promise<void> {
  if (!ctx.from) return;

  const state = creationState.get(ctx.from.id);

  if (!state || state.step !== 'venue') {
    await ctx.answerCallbackQuery('Сессия создания истекла');

    return;
  }

  const venue = await getVenue(venueId);

  if (!venue) {
    await ctx.answerCallbackQuery({
      text: 'Площадка не найдена',
      show_alert: true,
    });
    return;
  }

  state.data.venueId = venue.id;
  state.data.venueName = venue.name;

  state.step = 'discipline';

  const keyboard = new InlineKeyboard();

  for (const disc of discipline) {
    keyboard.text(DISCIPLINE_LABELS[disc] || disc, `discipline:${disc}`).row();
  }

  await ctx.answerCallbackQuery();

  await safeEditMessageText(ctx, {
    text:
      `Площадка: ${venue.name}\n\n` +
      `Шаг 4/${STEPS_COUNT}: Выберите дисциплину:`,
    reply_markup: keyboard,
  });
}

export async function handleDisciplineSelection(
  ctx: BotContext,
  selectedDiscipline: string,
): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const state = creationState.get(ctx.from.id);
  if (!state || state.step !== 'discipline') {
    await ctx.answerCallbackQuery('Сессия создания истекла');
    return;
  }

  state.data.discipline = selectedDiscipline;
  state.step = 'format';

  const keyboard = new InlineKeyboard();
  for (const fmt of tournamentFormat) {
    keyboard.text(FORMAT_LABELS[fmt] || fmt, `format:${fmt}`).row();
  }

  await ctx.answerCallbackQuery();
  await safeEditMessageText(ctx, {
    text:
      `Дисциплина: ${DISCIPLINE_LABELS[selectedDiscipline]}\n\n` +
      `Шаг 5/${STEPS_COUNT}: Выберите формат турнира:`,
    reply_markup: keyboard,
  });
}

export async function handleFormatSelection(
  ctx: BotContext,
  selectedFormat: string,
): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const state = creationState.get(ctx.from.id);
  if (!state || state.step !== 'format') {
    await ctx.answerCallbackQuery('Сессия создания истекла');
    return;
  }

  state.data.format = selectedFormat;
  state.step = 'maxParticipants';

  const keyboard = new InlineKeyboard()
    .text('8', 'participants:8')
    .text('16', 'participants:16')
    .text('32', 'participants:32')
    .row()
    .text('64', 'participants:64')
    .text('128', 'participants:128');

  await ctx.answerCallbackQuery();
  await safeEditMessageText(ctx, {
    text:
      `Формат: ${FORMAT_LABELS[selectedFormat]}\n\n` +
      `Шаг 6/${STEPS_COUNT}: Выберите максимальное количество участников:`,
    reply_markup: keyboard,
  });
}

export async function handleMaxParticipantsSelection(
  ctx: BotContext,
  participants: number,
): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const state = creationState.get(ctx.from.id);
  if (!state || state.step !== 'maxParticipants') {
    await ctx.answerCallbackQuery('Сессия создания истекла');
    return;
  }

  state.data.maxParticipants = participants;
  state.step = 'winScore';

  const keyboard = new InlineKeyboard()
    .text('До 2 побед', 'winscore:2')
    .text('До 3 побед', 'winscore:3')
    .row()
    .text('До 4 побед', 'winscore:4')
    .text('До 5 побед', 'winscore:5');

  await ctx.answerCallbackQuery();
  await safeEditMessageText(ctx, {
    text:
      `Участников: ${participants}\n\n` +
      `Шаг 7/${STEPS_COUNT}: До скольки побед играть?`,
    reply_markup: keyboard,
  });
}

export async function handleWinScoreSelection(
  ctx: BotContext,
  winScore: number,
): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const state = creationState.get(ctx.from.id);
  if (!state || state.step !== 'winScore') {
    await ctx.answerCallbackQuery('Сессия создания истекла');
    return;
  }

  if (!state.data.venueId) {
    creationState.delete(ctx.from.id);
    await ctx.answerCallbackQuery({
      text: 'Площадка не выбрана',
      show_alert: true,
    });
    return;
  }

  state.data.winScore = winScore;
  state.data.selectedTableIds = [];
  state.step = 'tables';

  await ctx.answerCallbackQuery();
  await renderTablesStep(ctx, state);
}

export async function handleTableSelectionToggle(
  ctx: BotContext,
  tableId: string,
): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const state = creationState.get(ctx.from.id);
  if (!state || state.step !== 'tables' || !state.data.venueId) {
    await ctx.answerCallbackQuery('Сессия создания истекла');
    return;
  }

  const tables = await getTablesByVenue(state.data.venueId);

  if (!tables.some((table) => table.id === tableId)) {
    await ctx.answerCallbackQuery({
      text: 'Можно выбрать только столы выбранной площадки',
      show_alert: true,
    });
    return;
  }

  const selected = new Set(state.data.selectedTableIds ?? []);

  if (selected.has(tableId)) {
    selected.delete(tableId);
  } else {
    selected.add(tableId);
  }
  state.data.selectedTableIds = Array.from(selected);

  await ctx.answerCallbackQuery();

  await renderTablesStep(ctx, state, tables);
}

export async function handleTableSelectionDone(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const state = creationState.get(ctx.from.id);
  if (!state || state.step !== 'tables') {
    await ctx.answerCallbackQuery('Сессия создания истекла');
    return;
  }

  await ctx.answerCallbackQuery();
  await finalizeTournamentCreation(
    ctx,
    state,
    state.data.selectedTableIds ?? [],
  );
}

export async function handleTableSelectionSkip(ctx: BotContext): Promise<void> {
  if (!ctx.from) {
    return;
  }

  const state = creationState.get(ctx.from.id);
  if (!state || state.step !== 'tables') {
    await ctx.answerCallbackQuery('Сессия создания истекла');
    return;
  }

  await ctx.answerCallbackQuery();
  await finalizeTournamentCreation(ctx, state, []);
}

function buildVenuesKeyboard(
  venues: Awaited<ReturnType<typeof getVenues>>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const venue of venues) {
    keyboard.text(venue.name, `venue:${venue.id}`).row();
  }

  return keyboard;
}

function buildTablesKeyboard(
  tables: Awaited<ReturnType<typeof getTablesByVenue>>,
  selectedTableIds: string[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const table of tables) {
    const isSelected = selectedTableIds.includes(table.id);
    const label = `${isSelected ? '✅' : '⬜'} ${table.name}`;
    keyboard.text(label, `tables_toggle:${table.id}`).row();
  }

  keyboard.text('Готово', 'tables_done');
  keyboard.text('Пропустить', 'tables_skip');

  return keyboard;
}

async function renderTablesStep(
  ctx: BotContext,
  state: CreationState,
  tables?: Awaited<ReturnType<typeof getTablesByVenue>>,
): Promise<void> {
  const availableTables =
    tables ??
    (state.data.venueId ? await getTablesByVenue(state.data.venueId) : []);
  const selectedCount = state.data.selectedTableIds?.length ?? 0;

  if (availableTables.length === 0) {
    await safeEditMessageText(ctx, {
      text:
        `До побед: ${state.data.winScore}\n` +
        `Площадка: ${state.data.venueName}\n\n` +
        `Шаг 8/${STEPS_COUNT}: У выбранной площадки нет столов.\n` +
        `Можно завершить создание турнира без привязки столов.`,
      reply_markup: new InlineKeyboard().text('Пропустить', 'tables_skip'),
    });
    return;
  }

  await safeEditMessageText(ctx, {
    text:
      `До побед: ${state.data.winScore}\n` +
      `Площадка: ${state.data.venueName}\n\n` +
      `Шаг 8/${STEPS_COUNT}: Выберите столы этой площадки или пропустите шаг.\n` +
      `Выбрано столов: ${selectedCount}`,
    reply_markup: buildTablesKeyboard(
      availableTables,
      state.data.selectedTableIds ?? [],
    ),
  });
}

async function finalizeTournamentCreation(
  ctx: BotContext,
  state: CreationState,
  tableIds: string[],
): Promise<void> {
  if (!ctx.from) {
    return;
  }

  if (
    !state.data.name ||
    !state.data.discipline ||
    !state.data.format ||
    !state.data.maxParticipants ||
    !state.data.winScore ||
    !state.data.venueId
  ) {
    creationState.delete(ctx.from.id);
    await safeEditMessageText(ctx, {
      text: 'Сессия создания повреждена. Начните создание турнира заново.',
    });
    return;
  }

  try {
    const tournament = await createTournamentDraft({
      name: state.data.name,
      discipline: state.data.discipline as (typeof discipline)[number],
      format: state.data.format as (typeof tournamentFormat)[number],
      maxParticipants: state.data.maxParticipants,
      winScore: state.data.winScore,
      startDate: state.data.startDate ?? null,
      venueId: state.data.venueId,
      tableIds,
      createdBy: ctx.dbUser.id,
    });

    creationState.delete(ctx.from.id);

    const keyboard = new InlineKeyboard()
      .text('Открыть регистрацию', `tournament_open_reg:${tournament.id}`)
      .row();

    await safeEditMessageText(ctx, {
      text:
        `✅ Турнир создан!\n\n` +
        `Название: ${tournament.name}\n` +
        `Дата начала: ${formatDate(tournament.startDate)}\n` +
        `Площадка: ${tournament.venueName ?? state.data.venueName}\n` +
        `Дисциплина: ${DISCIPLINE_LABELS[tournament.discipline]}\n` +
        `Формат: ${FORMAT_LABELS[tournament.format]}\n` +
        `Участников: ${tournament.maxParticipants}\n` +
        `До побед: ${tournament.winScore}\n` +
        `Столов выбрано: ${tableIds.length}\n` +
        `Статус: Черновик\n\n` +
        `ID: \`${tournament.id}\``,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('Error creating tournament:', error);
    await safeEditMessageText(ctx, {
      text: `❌ Ошибка при создании турнира:\n${error instanceof Error ? error.message : 'Неизвестная ошибка'}`,
    });
  }
}
