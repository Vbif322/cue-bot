import { Composer, InlineKeyboard } from "grammy";
import { and, eq, sql, inArray } from "drizzle-orm";
import { db } from "../../db/db.js";
import { tournaments, tournamentParticipants } from "../../db/schema.js";
import type { BotContext } from "../types.js";
import { formatDate } from "../../utils/dateHelpers.js";

export const registrationCommands = new Composer<BotContext>();

const DISCIPLINE_LABELS: Record<string, string> = {
  snooker: "Снукер",
};

const FORMAT_LABELS: Record<string, string> = {
  single_elimination: "Олимпийская система",
  double_elimination: "Двойная элиминация",
  round_robin: "Круговая система",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  registration_open: "Регистрация открыта",
  registration_closed: "Регистрация закрыта",
  in_progress: "В процессе",
  completed: "Завершён",
  cancelled: "Отменён",
};

// Получить количество участников турнира
async function getParticipantsCount(tournamentId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        inArray(tournamentParticipants.status, ["pending", "confirmed"]),
      ),
    );
  return result[0]?.count ?? 0;
}

// Получить регистрацию пользователя на турнир
async function getUserParticipation(tournamentId: string, userId: string) {
  return db.query.tournamentParticipants.findFirst({
    where: and(
      eq(tournamentParticipants.tournamentId, tournamentId),
      eq(tournamentParticipants.userId, userId),
    ),
  });
}

// Сформировать карточку турнира с учётом регистрации пользователя
async function formatTournamentCard(
  tournament: typeof tournaments.$inferSelect,
  userId: string,
  participantsCount?: number,
): Promise<string> {
  const count =
    participantsCount ?? (await getParticipantsCount(tournament.id));
  const participation = await getUserParticipation(tournament.id, userId);

  let registrationStatus = "";
  if (
    participation &&
    (participation.status === "confirmed" || participation.status === "pending")
  ) {
    registrationStatus = "\n✅ Вы зарегистрированы";
  }

  return (
    `📋 *${tournament.name}*\n\n` +
    `Дисциплина: ${DISCIPLINE_LABELS[tournament.discipline] || tournament.discipline}\n` +
    `Формат: ${FORMAT_LABELS[tournament.format] || tournament.format}\n` +
    `Участников: ${count}/${tournament.maxParticipants}\n` +
    `Дата: ${formatDate(tournament.startDate)}\n` +
    `Статус: ${STATUS_LABELS[tournament.status] || tournament.status}` +
    registrationStatus
  );
}

// Сформировать клавиатуру для карточки турнира
async function getTournamentKeyboard(
  tournament: typeof tournaments.$inferSelect,
  userId: string,
): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();

  if (tournament.status !== "registration_open") {
    return keyboard;
  }

  const participation = await getUserParticipation(tournament.id, userId);
  const count = await getParticipantsCount(tournament.id);
  const spotsAvailable = count < tournament.maxParticipants;

  if (!participation || participation.status === "cancelled") {
    if (spotsAvailable) {
      keyboard.text("Участвовать", `reg:join:${tournament.id}`);
    } else {
      keyboard.text("Мест нет", `reg:full:${tournament.id}`);
    }
  } else if (
    participation.status === "pending" ||
    participation.status === "confirmed"
  ) {
    keyboard.text("Отменить регистрацию", `reg:cancel:${tournament.id}`);
  }

  return keyboard;
}

// === РЕГИСТРАЦИЯ НА ТУРНИР ===
registrationCommands.callbackQuery(/^reg:join:(.+)$/, async (ctx) => {
  const tournamentId = ctx.match![1]!;
  const userId = ctx.dbUser.id;

  // 1. Проверить существование турнира
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.answerCallbackQuery({
      text: "Турнир не найден",
      show_alert: true,
    });
    return;
  }

  // 2. Проверить статус турнира
  if (tournament.status !== "registration_open") {
    await ctx.answerCallbackQuery({
      text: "Регистрация на этот турнир закрыта",
      show_alert: true,
    });
    return;
  }

  // 3. Проверить, не зарегистрирован ли уже
  const existing = await getUserParticipation(tournamentId, userId);

  if (existing && existing.status !== "cancelled") {
    await ctx.answerCallbackQuery({
      text: "Вы уже зарегистрированы на этот турнир",
      show_alert: true,
    });
    return;
  }

  // 4. Проверить лимит участников
  const count = await getParticipantsCount(tournamentId);

  if (count >= tournament.maxParticipants) {
    await ctx.answerCallbackQuery({
      text: "К сожалению, все места заняты",
      show_alert: true,
    });
    return;
  }

  // 5. Создать или обновить запись
  if (existing) {
    // Перерегистрация после отмены
    await db
      .update(tournamentParticipants)
      .set({ status: "confirmed", createdAt: new Date() })
      .where(
        and(
          eq(tournamentParticipants.tournamentId, tournamentId),
          eq(tournamentParticipants.userId, userId),
        ),
      );
  } else {
    await db.insert(tournamentParticipants).values({
      tournamentId,
      userId,
      status: "confirmed",
    });
  }

  // 6. Обновить сообщение
  await ctx.answerCallbackQuery({ text: "Вы зарегистрированы!" });

  const newKeyboard = await getTournamentKeyboard(tournament, userId);
  const updatedText = await formatTournamentCard(tournament, userId, count + 1);

  await ctx.editMessageText(updatedText, {
    parse_mode: "Markdown",
    reply_markup: newKeyboard,
  });
});

// === ОТМЕНА РЕГИСТРАЦИИ ===
registrationCommands.callbackQuery(/^reg:cancel:(.+)$/, async (ctx) => {
  const tournamentId = ctx.match![1]!;
  const userId = ctx.dbUser.id;

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.answerCallbackQuery({
      text: "Турнир не найден",
      show_alert: true,
    });
    return;
  }

  // Проверить, можно ли отменить (только до начала турнира)
  if (
    tournament.status === "in_progress" ||
    tournament.status === "completed"
  ) {
    await ctx.answerCallbackQuery({
      text: "Нельзя отменить регистрацию после начала турнира",
      show_alert: true,
    });
    return;
  }

  const participation = await getUserParticipation(tournamentId, userId);

  if (!participation || participation.status === "cancelled") {
    await ctx.answerCallbackQuery({
      text: "Вы не зарегистрированы на этот турнир",
      show_alert: true,
    });
    return;
  }

  // Обновить статус на cancelled
  await db
    .update(tournamentParticipants)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        eq(tournamentParticipants.userId, userId),
      ),
    );

  await ctx.answerCallbackQuery({ text: "Регистрация отменена" });

  // Обновить сообщение
  const count = await getParticipantsCount(tournamentId);
  const newKeyboard = await getTournamentKeyboard(tournament, userId);
  const updatedText = await formatTournamentCard(tournament, userId, count);

  await ctx.editMessageText(updatedText, {
    parse_mode: "Markdown",
    reply_markup: newKeyboard,
  });
});

// === МЕСТ НЕТ (заглушка для неактивной кнопки) ===
registrationCommands.callbackQuery(/^reg:full:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({
    text: "К сожалению, все места на турнир заняты",
    show_alert: true,
  });
});

// === МОИ ТУРНИРЫ ===
registrationCommands.command("my_tournaments", async (ctx) => {
  const userId = ctx.dbUser.id;

  const participations = await db
    .select({
      tournament: tournaments,
      participation: tournamentParticipants,
    })
    .from(tournamentParticipants)
    .innerJoin(
      tournaments,
      eq(tournamentParticipants.tournamentId, tournaments.id),
    )
    .where(
      and(
        eq(tournamentParticipants.userId, userId),
        inArray(tournamentParticipants.status, ["pending", "confirmed"]),
      ),
    )
    .orderBy(tournaments.startDate);

  if (participations.length === 0) {
    await ctx.reply(
      "Вы пока не зарегистрированы ни на один турнир.\n\n" +
        "Посмотрите доступные турниры: /tournaments",
    );
    return;
  }

  let message = "Ваши турниры:\n\n";
  const keyboard = new InlineKeyboard();

  for (const { tournament, participation } of participations) {
    const statusEmoji = participation.status === "confirmed" ? "✅" : "⏳";
    const statusText =
      participation.status === "confirmed" ? "Подтверждено" : "На рассмотрении";

    message +=
      `${statusEmoji} *${tournament.name}*\n` +
      `   Дата: ${formatDate(tournament.startDate)}\n` +
      `   Статус заявки: ${statusText}\n\n`;

    keyboard.text(tournament.name, `reg:view:${tournament.id}`).row();
  }

  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
});

// === ПРОСМОТР ТУРНИРА ИЗ СПИСКА ===
registrationCommands.callbackQuery(/^reg:view:(.+)$/, async (ctx) => {
  const tournamentId = ctx.match![1]!;
  const userId = ctx.dbUser.id;

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.answerCallbackQuery({
      text: "Турнир не найден",
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery();

  const text = await formatTournamentCard(tournament, userId);
  const keyboard = await getTournamentKeyboard(tournament, userId);

  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
});
