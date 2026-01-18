import { Composer, InlineKeyboard } from "grammy";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/db.js";
import {
  tournaments,
  tournamentFormat,
  discipline,
  tournamentParticipants,
} from "../../db/schema.js";
import type { BotContext } from "../types.js";
import { adminOnly } from "../guards.js";
import { isAdmin } from "../permissions.js";
import { formatDate, parseDate } from "../../utils/dateHelpers.js";
import {
  canStartTournament,
  getConfirmedParticipants,
  startTournament,
  assignRandomSeeds,
} from "../../services/tournamentService.js";
import { generateBracket, getBracketStats } from "../../services/bracketGenerator.js";
import { createMatches } from "../../services/matchService.js";

export const tournamentCommands = new Composer<BotContext>();

const STEPS_COUNT = 6;

// Получить количество участников турнира
async function getParticipantsCount(tournamentId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        inArray(tournamentParticipants.status, ["pending", "confirmed"])
      )
    );
  return result[0]?.count ?? 0;
}

const disciplineLabels: Record<string, string> = {
  // pool: "Пул",
  snooker: "Снукер",
  // russian_billiards: "Русский бильярд",
  // carom: "Карамболь",
};

const formatLabels: Record<string, string> = {
  single_elimination: "Олимпийская система",
  double_elimination: "Двойная элиминация",
  round_robin: "Круговая система",
};

const statusLabels = {
  draft: "Черновик",
  registration_open: "Регистрация открыта",
  registration_closed: "Регистрация закрыта",
  in_progress: "В процессе",
  completed: "Завершён",
  cancelled: "Отменён",
};

// Временное хранилище для создания турнира (в продакшене лучше использовать сессии)
const creationState = new Map<
  number,
  {
    step: string;
    lastMessageId?: number;
    data: Partial<{
      name: string;
      discipline: string;
      format: string;
      maxParticipants: number;
      winScore: number;
      description: string;
      start_date: Date;
    }>;
  }
>();

// /create_tournament - начать создание турнира
tournamentCommands.command("create_tournament", adminOnly(), async (ctx) => {
  const userId = ctx.from!.id;

  const msg = await ctx.reply(
    "Создание нового турнира\n\n" +
      `Шаг 1/${STEPS_COUNT}: Введите название турнира:`,
  );

  creationState.set(userId, {
    step: "name",
    lastMessageId: msg.message_id,
    data: {},
  });
});

// /cancel - отменить создание
tournamentCommands.command("cancel", async (ctx) => {
  const userId = ctx.from!.id;

  if (creationState.has(userId)) {
    creationState.delete(userId);
    await ctx.reply("Создание турнира отменено.");
  } else {
    await ctx.reply("Нет активного процесса создания турнира.");
  }
});

// /tournaments - список турниров
tournamentCommands.command("tournaments", async (ctx) => {
  const admin = isAdmin(ctx);
  const allTournaments = await db.query.tournaments.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 10,
  });

  if (allTournaments.length === 0) {
    await ctx.reply("Турниров пока нет.");
    return;
  }

  // Фильтруем турниры для обычных пользователей
  const visibleTournaments = admin
    ? allTournaments
    : allTournaments.filter((t) => t.status !== "draft");

  if (visibleTournaments.length === 0) {
    await ctx.reply("Турниров пока нет.");
    return;
  }

  let message = "Список турниров:\n\n";
  const keyboard = new InlineKeyboard();

  for (const t of visibleTournaments) {
    const participantsCount = await getParticipantsCount(t.id);

    message +=
      `📋 *${t.name}*\n` +
      `   Дисциплина: ${disciplineLabels[t.discipline] || t.discipline}\n` +
      `   Формат: ${formatLabels[t.format] || t.format}\n` +
      `   Статус: ${statusLabels[t.status] || t.status}\n` +
      `   Участников: ${participantsCount}/${t.maxParticipants}\n` +
      `   Дата: ${formatDate(t.startDate)}\n` +
      (admin ? `   ID: \`${t.id}\`\n` : "") +
      "\n";

    // Добавляем кнопки для турниров с открытой регистрацией
    if (t.status === "registration_open") {
      keyboard
        .text(`📋 ${t.name}`, `reg:view:${t.id}`)
        .text("Участвовать", `reg:join:${t.id}`)
        .row();
    }
  }

  if (keyboard.inline_keyboard.length > 0) {
    await ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(message, { parse_mode: "Markdown" });
  }
});

// /tournament <id> - информация о турнире
tournamentCommands.command("tournament", async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);

  if (!args || args.length === 0 || args[0]?.trim() === "") {
    // Если аргумент не указан, показываем список турниров для выбора
    const admin = isAdmin(ctx);
    const allTournaments = await db.query.tournaments.findMany({
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 10,
    });

    const visibleTournaments = admin
      ? allTournaments
      : allTournaments.filter((t) => t.status !== "draft");

    if (visibleTournaments.length === 0) {
      await ctx.reply("Турниров пока нет.");
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const t of visibleTournaments) {
      keyboard.text(`📋 ${t.name}`, `tournament_info:${t.id}`).row();
    }

    await ctx.reply("Выберите турнир:", { reply_markup: keyboard });
    return;
  }

  const tournamentId = args[0]!;

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.reply("Турнир не найден.");
    return;
  }

  const participantsCount = await getParticipantsCount(tournamentId);

  // Проверяем регистрацию пользователя
  const userParticipation = await db.query.tournamentParticipants.findFirst({
    where: and(
      eq(tournamentParticipants.tournamentId, tournamentId),
      eq(tournamentParticipants.userId, ctx.dbUser.id)
    ),
  });

  const isRegistered =
    userParticipation &&
    (userParticipation.status === "confirmed" ||
      userParticipation.status === "pending");

  const message =
    `📋 *${tournament.name}*\n\n` +
    `Дисциплина: ${
      disciplineLabels[tournament.discipline] || tournament.discipline
    }\n` +
    `Формат: ${formatLabels[tournament.format] || tournament.format}\n` +
    `Статус: ${statusLabels[tournament.status] || tournament.status}\n` +
    `Участников: ${participantsCount}/${tournament.maxParticipants}\n` +
    `Дата: ${formatDate(tournament.startDate)}\n` +
    `Игра до: ${tournament.winScore} побед\n` +
    (tournament.description ? `\nОписание: ${tournament.description}\n` : "") +
    (isRegistered ? "\n✅ Вы зарегистрированы" : "") +
    (isAdmin(ctx) ? `\n\nID: \`${tournament.id}\`` : "");

  const keyboard = new InlineKeyboard();

  // Кнопки регистрации для пользователей
  if (tournament.status === "registration_open") {
    if (!isRegistered) {
      if (participantsCount < tournament.maxParticipants) {
        keyboard.text("Участвовать", `reg:join:${tournament.id}`).row();
      } else {
        keyboard.text("Мест нет", `reg:full:${tournament.id}`).row();
      }
    } else {
      keyboard.text("Отменить регистрацию", `reg:cancel:${tournament.id}`).row();
    }
  }

  // Админские кнопки
  if (isAdmin(ctx)) {
    if (tournament.status === "draft") {
      keyboard
        .text("Открыть регистрацию", `tournament_open_reg:${tournament.id}`)
        .row();
      keyboard.text("Удалить", `tournament_delete:${tournament.id}`).row();
    }
    if (tournament.status === "registration_open") {
      keyboard
        .text("Закрыть регистрацию", `tournament_close_reg:${tournament.id}`)
        .row();
    }
    if (tournament.status === "registration_closed") {
      keyboard
        .text("🚀 Начать турнир", `tournament_start:${tournament.id}`)
        .row();
    }
    if (tournament.status === "in_progress") {
      keyboard
        .text("📊 Сетка турнира", `bracket:view:${tournament.id}`)
        .row();
    }
  }

  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
});

// /delete_tournament <id> - удалить турнир
tournamentCommands.command("delete_tournament", adminOnly(), async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);

  if (!args || args.length === 0 || args[0]?.trim() === "") {
    // Показываем список турниров, которые можно удалить
    const deletableTournaments = await db.query.tournaments.findMany({
      where: inArray(tournaments.status, ["draft", "cancelled"]),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 10,
    });

    if (deletableTournaments.length === 0) {
      await ctx.reply("Нет турниров, доступных для удаления.\n\nУдалить можно только турниры в статусе 'Черновик' или 'Отменён'.");
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const t of deletableTournaments) {
      const statusEmoji = t.status === "draft" ? "📝" : "❌";
      keyboard.text(`${statusEmoji} ${t.name}`, `tournament_delete_confirm:${t.id}`).row();
    }

    await ctx.reply("Выберите турнир для удаления:", { reply_markup: keyboard });
    return;
  }

  const tournamentId = args[0]!;

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.reply("Турнир не найден");
    return;
  }

  if (tournament.status !== "draft" && tournament.status !== "cancelled") {
    await ctx.reply(
      "Можно удалить только турниры в статусе 'Черновик' или 'Отменён'",
    );
    return;
  }

  await db.delete(tournaments).where(eq(tournaments.id, tournamentId));

  await ctx.reply(`Турнир "${tournament.name}" удалён`);
});

// Обработка callback-кнопок турнира
tournamentCommands.callbackQuery(/^tournament_open_reg:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery("Недостаточно прав");
    return;
  }

  const tournamentId = ctx.match![1]!;

  await db
    .update(tournaments)
    .set({ status: "registration_open" })
    .where(eq(tournaments.id, tournamentId));

  await ctx.answerCallbackQuery("Регистрация открыта");
  await ctx.editMessageText(
    ctx.callbackQuery.message?.text + "\n\n✅ Регистрация открыта!",
  );
});

tournamentCommands.callbackQuery(/^tournament_close_reg:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery("Недостаточно прав");
    return;
  }

  const tournamentId = ctx.match![1]!;

  await db
    .update(tournaments)
    .set({ status: "registration_closed" })
    .where(eq(tournaments.id, tournamentId));

  await ctx.answerCallbackQuery("Регистрация закрыта");
  await ctx.editMessageText(
    ctx.callbackQuery.message?.text + "\n\n🔒 Регистрация закрыта!",
  );
});

tournamentCommands.callbackQuery(/^tournament_delete:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery("Недостаточно прав");
    return;
  }

  const tournamentId = ctx.match![1]!;

  await db.delete(tournaments).where(eq(tournaments.id, tournamentId));

  await ctx.answerCallbackQuery("Турнир удалён");
  await ctx.editMessageText("🗑 Турнир удалён");
});

// Обработка выбора турнира для удаления (из списка /delete_tournament)
tournamentCommands.callbackQuery(/^tournament_delete_confirm:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery("Недостаточно прав");
    return;
  }

  const tournamentId = ctx.match![1]!;

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.answerCallbackQuery({ text: "Турнир не найден", show_alert: true });
    return;
  }

  if (tournament.status !== "draft" && tournament.status !== "cancelled") {
    await ctx.answerCallbackQuery({
      text: "Этот турнир больше нельзя удалить",
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard()
    .text("✅ Да, удалить", `tournament_delete:${tournament.id}`)
    .text("❌ Отмена", `tournament_delete_cancel`);

  await ctx.editMessageText(
    `Вы уверены, что хотите удалить турнир?\n\n` +
      `📋 *${tournament.name}*\n` +
      `Статус: ${statusLabels[tournament.status] || tournament.status}`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
});

// Отмена удаления турнира
tournamentCommands.callbackQuery("tournament_delete_cancel", async (ctx) => {
  await ctx.answerCallbackQuery("Удаление отменено");
  await ctx.editMessageText("Удаление отменено.");
});

// === ЗАПУСК ТУРНИРА ===

// Показать подтверждение запуска турнира
tournamentCommands.callbackQuery(/^tournament_start:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery("Недостаточно прав");
    return;
  }

  const tournamentId = ctx.match![1]!;

  const result = await canStartTournament(tournamentId);

  if (!result.canStart) {
    await ctx.answerCallbackQuery({
      text: result.error || "Невозможно запустить турнир",
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery();

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.editMessageText("Турнир не найден");
    return;
  }

  const stats = getBracketStats(
    tournament.format as "single_elimination" | "double_elimination" | "round_robin",
    result.participantsCount
  );

  const keyboard = new InlineKeyboard()
    .text("✅ Да, начать турнир", `tournament_start_confirm:${tournamentId}`)
    .row()
    .text("❌ Отмена", `tournament_info:${tournamentId}`);

  await ctx.editMessageText(
    `🚀 *Запуск турнира "${tournament.name}"*\n\n` +
      `Участников: ${result.participantsCount}\n` +
      `Формат: ${formatLabels[tournament.format] || tournament.format}\n` +
      `Матчей будет создано: ${stats.totalMatches}\n` +
      `Раундов: ${stats.totalRounds}\n\n` +
      `⚠️ После запуска:\n` +
      `• Сиды будут назначены случайным образом\n` +
      `• Сетка будет сформирована автоматически\n` +
      `• Регистрация новых участников будет невозможна\n\n` +
      `Вы уверены?`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
});

// Подтверждение и запуск турнира
tournamentCommands.callbackQuery(/^tournament_start_confirm:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery("Недостаточно прав");
    return;
  }

  const tournamentId = ctx.match![1]!;

  // Повторная проверка
  const result = await canStartTournament(tournamentId);

  if (!result.canStart) {
    await ctx.answerCallbackQuery({
      text: result.error || "Невозможно запустить турнир",
      show_alert: true,
    });
    return;
  }

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.answerCallbackQuery({ text: "Турнир не найден", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery("Запуск турнира...");

  try {
    // 1. Назначить случайные сиды
    await assignRandomSeeds(tournamentId);

    // 2. Получить участников с сидами
    const participants = await getConfirmedParticipants(tournamentId);

    // 3. Сгенерировать сетку
    const bracket = generateBracket(
      tournament.format as "single_elimination" | "double_elimination" | "round_robin",
      participants
    );

    // 4. Создать матчи в БД
    await createMatches(tournamentId, bracket);

    // 5. Обновить статус турнира
    await startTournament(tournamentId);

    const keyboard = new InlineKeyboard()
      .text("📊 Посмотреть сетку", `bracket:view:${tournamentId}`)
      .row();

    await ctx.editMessageText(
      `✅ *Турнир "${tournament.name}" запущен!*\n\n` +
        `Участников: ${participants.length}\n` +
        `Матчей создано: ${bracket.length}\n\n` +
        `Сетка сформирована, участники могут начинать играть.\n` +
        `Используйте /my_match для просмотра своего текущего матча.`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );

    // TODO: Отправить уведомления участникам о начале турнира
  } catch (error) {
    console.error("Error starting tournament:", error);
    await ctx.editMessageText(
      `❌ Ошибка при запуске турнира:\n${error instanceof Error ? error.message : "Неизвестная ошибка"}`
    );
  }
});

// Обработка выбора турнира из списка (когда /tournament вызвана без аргумента)
tournamentCommands.callbackQuery(/^tournament_info:(.+)$/, async (ctx) => {
  const tournamentId = ctx.match![1]!;

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.answerCallbackQuery({ text: "Турнир не найден", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();

  const participantsCount = await getParticipantsCount(tournamentId);

  const userParticipation = await db.query.tournamentParticipants.findFirst({
    where: and(
      eq(tournamentParticipants.tournamentId, tournamentId),
      eq(tournamentParticipants.userId, ctx.dbUser.id)
    ),
  });

  const isRegistered =
    userParticipation &&
    (userParticipation.status === "confirmed" ||
      userParticipation.status === "pending");

  const message =
    `📋 *${tournament.name}*\n\n` +
    `Дисциплина: ${
      disciplineLabels[tournament.discipline] || tournament.discipline
    }\n` +
    `Формат: ${formatLabels[tournament.format] || tournament.format}\n` +
    `Статус: ${statusLabels[tournament.status] || tournament.status}\n` +
    `Участников: ${participantsCount}/${tournament.maxParticipants}\n` +
    `Дата: ${formatDate(tournament.startDate)}\n` +
    `Игра до: ${tournament.winScore} побед\n` +
    (tournament.description ? `\nОписание: ${tournament.description}\n` : "") +
    (isRegistered ? "\n✅ Вы зарегистрированы" : "") +
    (isAdmin(ctx) ? `\n\nID: \`${tournament.id}\`` : "");

  const keyboard = new InlineKeyboard();

  if (tournament.status === "registration_open") {
    if (!isRegistered) {
      if (participantsCount < tournament.maxParticipants) {
        keyboard.text("Участвовать", `reg:join:${tournament.id}`).row();
      } else {
        keyboard.text("Мест нет", `reg:full:${tournament.id}`).row();
      }
    } else {
      keyboard.text("Отменить регистрацию", `reg:cancel:${tournament.id}`).row();
    }
  }

  if (isAdmin(ctx)) {
    if (tournament.status === "draft") {
      keyboard
        .text("Открыть регистрацию", `tournament_open_reg:${tournament.id}`)
        .row();
      keyboard.text("Удалить", `tournament_delete:${tournament.id}`).row();
    }
    if (tournament.status === "registration_open") {
      keyboard
        .text("Закрыть регистрацию", `tournament_close_reg:${tournament.id}`)
        .row();
    }
    if (tournament.status === "registration_closed") {
      keyboard
        .text("🚀 Начать турнир", `tournament_start:${tournament.id}`)
        .row();
    }
    if (tournament.status === "in_progress") {
      keyboard
        .text("📊 Сетка турнира", `bracket:view:${tournament.id}`)
        .row();
    }
  }

  await ctx.editMessageText(message, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
});

// Обработка выбора дисциплины
tournamentCommands.callbackQuery(/^discipline:(.+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const state = creationState.get(userId);

  if (!state || state.step !== "discipline") {
    await ctx.answerCallbackQuery("Сессия создания истекла");
    return;
  }

  const selectedDiscipline = ctx.match![1]!;
  state.data.discipline = selectedDiscipline;
  state.step = "format";

  await ctx.answerCallbackQuery();

  const keyboard = new InlineKeyboard();
  for (const fmt of tournamentFormat) {
    keyboard.text(formatLabels[fmt] || fmt, `format:${fmt}`).row();
  }

  await ctx.editMessageText(
    `Дисциплина: ${disciplineLabels[selectedDiscipline]}\n\n` +
      `Шаг 3/${STEPS_COUNT}: Выберите формат турнира:`,
    { reply_markup: keyboard },
  );
});

// Обработка выбора формата
tournamentCommands.callbackQuery(/^format:(.+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const state = creationState.get(userId);

  if (!state || state.step !== "format") {
    await ctx.answerCallbackQuery("Сессия создания истекла");
    return;
  }

  const selectedFormat = ctx.match![1]!;
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
    `Формат: ${formatLabels[selectedFormat]}\n\n` +
      `Шаг 5/${STEPS_COUNT}: Выберите максимальное количество участников:`,
    { reply_markup: keyboard },
  );
});

// Обработка выбора количества участников
tournamentCommands.callbackQuery(/^participants:(\d+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const state = creationState.get(userId);

  if (!state || state.step !== "maxParticipants") {
    await ctx.answerCallbackQuery("Сессия создания истекла");
    return;
  }

  const participants = parseInt(ctx.match![1]!, 10);
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
});

// Обработка выбора количества побед
tournamentCommands.callbackQuery(/^winscore:(\d+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const state = creationState.get(userId);

  if (!state || state.step !== "winScore") {
    await ctx.answerCallbackQuery("Сессия создания истекла");
    return;
  }

  const winScore = parseInt(ctx.match![1]!, 10);
  state.data.winScore = winScore;

  await ctx.answerCallbackQuery();

  // Создаём турнир
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
    .text("Открыть регистрацию", `tournament_open_reg:${newTournament!.id}`)
    .row();

  await ctx.editMessageText(
    `✅ Турнир создан!\n\n` +
      `Название: ${newTournament.name}\n` +
      `Дата начала: ${formatDate(newTournament.startDate)}\n ` +
      `Дисциплина: ${disciplineLabels[newTournament.discipline]}\n` +
      `Формат: ${formatLabels[newTournament.format]}\n` +
      `Участников: ${newTournament.maxParticipants}\n` +
      `До побед: ${newTournament.winScore}\n` +
      `Статус: Черновик\n\n` +
      `ID: \`${newTournament.id}\``,
    { parse_mode: "Markdown", reply_markup: keyboard },
  );
});

// Обработка текстовых сообщений для создания турнира
tournamentCommands.on("message:text", async (ctx, next) => {
  const userId = ctx.from.id;
  const state = creationState.get(userId);

  if (!state || !state.lastMessageId) {
    return next();
  }

  const text = ctx.message.text;

  if (state.step === "name") {
    if (text.length < 3) {
      await ctx.reply("Название должно быть минимум 3 символа.");
      return;
    }

    state.data.name = text;
    state.step = "date";

    await ctx.reply(
      `Название: ${text}\n\nШаг 2/${STEPS_COUNT}: Введите дату турнира:`,
    );
    return;
  }

  if (state.step === "date") {
    const parsedDate = parseDate(text);
    if (!parsedDate) {
      await ctx.editMessageText(
        "Не удалось распознать дату, попробуйте еще раз",
      );
      return;
    } else {
      state.data.start_date = parsedDate;
      state.step = "discipline";

      const keyboard = new InlineKeyboard();
      for (const disc of discipline) {
        keyboard
          .text(disciplineLabels[disc] || disc, `discipline:${disc}`)
          .row();
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
      return;
    }
  }

  return next();
});
