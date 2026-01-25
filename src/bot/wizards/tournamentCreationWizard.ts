import { Composer, InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { db } from "../../db/db.js";
import { tournaments, tournamentFormat, discipline } from "../../db/schema.js";
import { parseDate, formatDate } from "../../utils/dateHelpers.js";
import { DISCIPLINE_LABELS, FORMAT_LABELS } from "../../utils/constants.js";

const STEPS_COUNT = 6;

type CreationStep =
  | "name"
  | "date"
  | "discipline"
  | "format"
  | "maxParticipants"
  | "winScore";

interface CreationData {
  name?: string;
  discipline?: string;
  format?: string;
  maxParticipants?: number;
  winScore?: number;
  description?: string;
  start_date?: Date;
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
    step: "name",
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

  if (!state || state.step !== "name") {
    return false;
  }

  if (text.length < 3) {
    await ctx.reply("Название должно быть минимум 3 символа.");
    return true;
  }

  state.data.name = text;
  state.step = "date";

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

  if (!state || state.step !== "date") {
    return false;
  }

  const parsedDate = parseDate(text);
  if (!parsedDate) {
    await ctx.reply("Не удалось распознать дату, попробуйте еще раз");
    return true;
  }

  state.data.start_date = parsedDate;
  state.step = "discipline";

  const keyboard = new InlineKeyboard();
  for (const disc of discipline) {
    keyboard.text(DISCIPLINE_LABELS[disc] || disc, `discipline:${disc}`).row();
  }

  await ctx.reply(
    `Дата: ${parsedDate.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    })}\n\nШаг 3/${STEPS_COUNT}: Выберите дисциплину:`,
    {
      reply_markup: keyboard,
    },
  );
  return true;
}

/**
 * Handle discipline selection (Step 3)
 */
export async function handleDisciplineSelection(
  ctx: BotContext,
  selectedDiscipline: string,
): Promise<void> {
  if (!ctx.from) {
    return;
  }
  const userId = ctx.from.id;
  const state = creationState.get(userId);

  if (!state || state.step !== "discipline") {
    await ctx.answerCallbackQuery("Сессия создания истекла");
    return;
  }

  state.data.discipline = selectedDiscipline;
  state.step = "format";

  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard();
  for (const fmt of tournamentFormat) {
    keyboard.text(FORMAT_LABELS[fmt] || fmt, `format:${fmt}`).row();
  }

  await ctx.editMessageText(
    `Дисциплина: ${DISCIPLINE_LABELS[selectedDiscipline]}\n\n` +
      `Шаг 3/${STEPS_COUNT}: Выберите формат турнира:`,
    { reply_markup: keyboard },
  );
}

/**
 * Handle format selection (Step 4)
 */
export async function handleFormatSelection(
  ctx: BotContext,
  selectedFormat: string,
): Promise<void> {
  if (!ctx.from) {
    return;
  }
  const userId = ctx.from.id;
  const state = creationState.get(userId);

  if (!state || state.step !== "format") {
    await ctx.answerCallbackQuery("Сессия создания истекла");
    return;
  }

  state.data.format = selectedFormat;
  state.step = "maxParticipants";

  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text("8", "participants:8")
    .text("16", "participants:16")
    .text("32", "participants:32")
    .row()
    .text("64", "participants:64")
    .text("128", "participants:128");

  await ctx.editMessageText(
    `Формат: ${FORMAT_LABELS[selectedFormat]}\n\n` +
      `Шаг 5/${STEPS_COUNT}: Выберите максимальное количество участников:`,
    { reply_markup: keyboard },
  );
}

/**
 * Handle max participants selection (Step 5)
 */
export async function handleMaxParticipantsSelection(
  ctx: BotContext,
  participants: number,
): Promise<void> {
  if (!ctx.from) {
    return;
  }
  const userId = ctx.from.id;
  const state = creationState.get(userId);

  if (!state || state.step !== "maxParticipants") {
    await ctx.answerCallbackQuery("Сессия создания истекла");
    return;
  }

  state.data.maxParticipants = participants;
  state.step = "winScore";

  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text("До 2 побед", "winscore:2")
    .text("До 3 побед", "winscore:3")
    .row()
    .text("До 4 побед", "winscore:4")
    .text("До 5 побед", "winscore:5");

  await ctx.editMessageText(
    `Участников: ${participants}\n\n` +
      `Шаг 6/${STEPS_COUNT}: До скольки побед играть?`,
    { reply_markup: keyboard },
  );
}

/**
 * Handle win score selection and create tournament (Step 6)
 */
export async function handleWinScoreSelection(
  ctx: BotContext,
  winScore: number,
): Promise<void> {
  if (!ctx.from) {
    return;
  }
  const userId = ctx.from.id;
  const state = creationState.get(userId);

  if (!state || state.step !== "winScore") {
    await ctx.answerCallbackQuery("Сессия создания истекла");
    return;
  }

  state.data.winScore = winScore;

  await ctx.answerCallbackQuery();

  try {
    // Create tournament
    const [newTournament] = await db
      .insert(tournaments)
      .values({
        name: state.data.name!,
        discipline: state.data.discipline as (typeof discipline)[number],
        format: state.data.format as (typeof tournamentFormat)[number],
        maxParticipants: state.data.maxParticipants!,
        winScore: winScore,
        createdBy: ctx.dbUser.id,
        status: "draft",
        startDate: state.data.start_date,
      })
      .returning();

    if (!newTournament) {
      await ctx.editMessageText("При создании турнира возникла ошибка");
      return;
    }

    creationState.delete(userId);

    const keyboard = new InlineKeyboard()
      .text("Открыть регистрацию", `tournament_open_reg:${newTournament.id}`)
      .row();

    await ctx.editMessageText(
      `✅ Турнир создан!\n\n` +
        `Название: ${newTournament.name}\n` +
        `Дата начала: ${formatDate(newTournament.startDate)}\n ` +
        `Дисциплина: ${DISCIPLINE_LABELS[newTournament.discipline]}\n` +
        `Формат: ${FORMAT_LABELS[newTournament.format]}\n` +
        `Участников: ${newTournament.maxParticipants}\n` +
        `До побед: ${newTournament.winScore}\n` +
        `Статус: Черновик\n\n` +
        `ID: \`${newTournament.id}\``,
      { parse_mode: "Markdown", reply_markup: keyboard },
    );
  } catch (error) {
    console.error("Error creating tournament:", error);
    await ctx.editMessageText(
      `❌ Ошибка при создании турнира:\n${error instanceof Error ? error.message : "Неизвестная ошибка"}`,
    );
  }
}
