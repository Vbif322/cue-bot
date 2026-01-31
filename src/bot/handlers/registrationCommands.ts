import { Composer, InlineKeyboard } from "grammy";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/db.js";
import { tournaments, tournamentParticipants } from "../../db/schema.js";
import type { BotContext } from "../types.js";
import { formatDate } from "../../utils/dateHelpers.js";
import { safeEditMessageText } from "../../utils/messageHelpers.js";
import {
  getTournamentInfo,
  buildTournamentMessage,
  buildTournamentKeyboard,
} from "../ui/tournamentUI.js";

export const registrationCommands = new Composer<BotContext>();

// Получить регистрацию пользователя на турнир
async function getUserParticipation(tournamentId: string, userId: string) {
  return db.query.tournamentParticipants.findFirst({
    where: and(
      eq(tournamentParticipants.tournamentId, tournamentId),
      eq(tournamentParticipants.userId, userId),
    ),
  });
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
  const tournamentInfo = await getTournamentInfo(tournament, userId);

  if (tournamentInfo.participantsCount >= tournament.maxParticipants) {
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

  const updatedInfo = await getTournamentInfo(tournament, userId);
  const isAdmin = ctx.dbUser.role === "admin";
  const updatedText = buildTournamentMessage(updatedInfo, isAdmin);
  const newKeyboard = buildTournamentKeyboard(updatedInfo, isAdmin);

  await safeEditMessageText(ctx, {
    text: updatedText,
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
  const updatedInfo = await getTournamentInfo(tournament, userId);
  const isAdmin = ctx.dbUser.role === "admin";
  const updatedText = buildTournamentMessage(updatedInfo, isAdmin);
  const newKeyboard = buildTournamentKeyboard(updatedInfo, isAdmin);

  await safeEditMessageText(ctx, {
    text: updatedText,
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

    keyboard.text(tournament.name, `tournament_info:${tournament.id}`).row();
  }

  await ctx.reply(message, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
});

