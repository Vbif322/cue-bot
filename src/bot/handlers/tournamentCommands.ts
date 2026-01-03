import { Composer, InlineKeyboard } from "grammy";
import { eq } from "drizzle-orm";
import { db } from "../../db/db.js";
import {
  tournaments,
  tournamentFormat,
  discipline,
  tournamentStatus,
} from "../../db/schema.js";
import type { BotContext } from "../types.js";
import { adminOnly } from "../guards.js";
import { isAdmin } from "../permissions.js";

export const tournamentCommands = new Composer<BotContext>();

const disciplineLabels: Record<string, string> = {
  pool: "Пул",
  snooker: "Снукер",
  russian_billiards: "Русский бильярд",
  carom: "Карамболь",
};

const formatLabels: Record<string, string> = {
  single_elimination: "Олимпийская система",
  double_elimination: "Двойная элиминация",
  round_robin: "Круговая система",
};

const statusLabels: Record<string, string> = {
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
    data: Partial<{
      name: string;
      discipline: string;
      format: string;
      maxParticipants: number;
      winScore: number;
      description: string;
    }>;
  }
>();

// /create_tournament - начать создание турнира
tournamentCommands.command("create_tournament", adminOnly(), async (ctx) => {
  const userId = ctx.from!.id;

  creationState.set(userId, { step: "name", data: {} });

  await ctx.reply(
    "Создание нового турнира\n\n" + "Шаг 1/5: Введите название турнира:"
  );
});

// /cancel_creation - отменить создание
tournamentCommands.command("cancel_creation", async (ctx) => {
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
  const allTournaments = await db.query.tournaments.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 10,
  });

  if (allTournaments.length === 0) {
    await ctx.reply("Турниров пока нет.");
    return;
  }

  let message = "Список турниров:\n\n";

  for (const t of allTournaments) {
    message +=
      `📋 *${t.name}*\n` +
      `   Дисциплина: ${disciplineLabels[t.discipline] || t.discipline}\n` +
      `   Формат: ${formatLabels[t.format] || t.format}\n` +
      `   Статус: ${statusLabels[t.status] || t.status}\n` +
      `   Участников: макс. ${t.maxParticipants}\n` +
      `   ID: \`${t.id}\`\n\n`;
  }

  await ctx.reply(message, { parse_mode: "Markdown" });
});

// /tournament <id> - информация о турнире
tournamentCommands.command("tournament", async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);

  if (!args || args.length === 0) {
    await ctx.reply("Использование: /tournament <id>");
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

  const message =
    `📋 *${tournament.name}*\n\n` +
    `Дисциплина: ${disciplineLabels[tournament.discipline] || tournament.discipline}\n` +
    `Формат: ${formatLabels[tournament.format] || tournament.format}\n` +
    `Статус: ${statusLabels[tournament.status] || tournament.status}\n` +
    `Макс. участников: ${tournament.maxParticipants}\n` +
    `Игра до: ${tournament.winScore} побед\n` +
    (tournament.description ? `\nОписание: ${tournament.description}\n` : "") +
    `\nID: \`${tournament.id}\``;

  const keyboard = new InlineKeyboard();

  if (isAdmin(ctx)) {
    if (tournament.status === "draft") {
      keyboard
        .text("Открыть регистрацию", `tournament_open_reg:${tournament.id}`)
        .row();
      keyboard
        .text("Удалить", `tournament_delete:${tournament.id}`)
        .row();
    }
    if (tournament.status === "registration_open") {
      keyboard
        .text("Закрыть регистрацию", `tournament_close_reg:${tournament.id}`)
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

  if (!args || args.length === 0) {
    await ctx.reply("Использование: /delete_tournament <id>");
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

  if (tournament.status !== "draft" && tournament.status !== "cancelled") {
    await ctx.reply(
      "Можно удалить только турниры в статусе 'Черновик' или 'Отменён'."
    );
    return;
  }

  await db.delete(tournaments).where(eq(tournaments.id, tournamentId));

  await ctx.reply(`Турнир "${tournament.name}" удалён.`);
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
    ctx.callbackQuery.message?.text + "\n\n✅ Регистрация открыта!"
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
    ctx.callbackQuery.message?.text + "\n\n🔒 Регистрация закрыта!"
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
      "Шаг 3/5: Выберите формат турнира:",
    { reply_markup: keyboard }
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
      "Шаг 4/5: Выберите максимальное количество участников:",
    { reply_markup: keyboard }
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
    `Участников: ${participants}\n\n` + "Шаг 5/5: До скольки побед играть?",
    { reply_markup: keyboard }
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
    })
    .returning();

  creationState.delete(userId);

  const keyboard = new InlineKeyboard()
    .text("Открыть регистрацию", `tournament_open_reg:${newTournament!.id}`)
    .row()
    .text("Посмотреть турнир", `tournament_view:${newTournament!.id}`);

  await ctx.editMessageText(
    `✅ Турнир создан!\n\n` +
      `Название: ${newTournament!.name}\n` +
      `Дисциплина: ${disciplineLabels[newTournament!.discipline]}\n` +
      `Формат: ${formatLabels[newTournament!.format]}\n` +
      `Участников: ${newTournament!.maxParticipants}\n` +
      `До побед: ${newTournament!.winScore}\n` +
      `Статус: Черновик\n\n` +
      `ID: \`${newTournament!.id}\``,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
});

// Обработка текстовых сообщений для создания турнира
tournamentCommands.on("message:text", async (ctx, next) => {
  const userId = ctx.from!.id;
  const state = creationState.get(userId);

  if (!state) {
    return next();
  }

  const text = ctx.message.text;

  if (state.step === "name") {
    if (text.length < 3) {
      await ctx.reply("Название должно быть минимум 3 символа.");
      return;
    }

    state.data.name = text;
    state.step = "discipline";

    const keyboard = new InlineKeyboard();
    for (const disc of discipline) {
      keyboard.text(disciplineLabels[disc] || disc, `discipline:${disc}`).row();
    }

    await ctx.reply(`Название: ${text}\n\nШаг 2/5: Выберите дисциплину:`, {
      reply_markup: keyboard,
    });
    return;
  }

  return next();
});
