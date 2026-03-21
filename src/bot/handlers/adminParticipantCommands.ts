import { Composer, InlineKeyboard } from "grammy";
import { eq, and } from "drizzle-orm";
import { db } from "../../db/db.js";
import { tournamentParticipants, users } from "../../db/schema.js";
import type { BotContext } from "../types.js";
import {
  confirmParticipant,
  rejectParticipant,
  getTournament,
} from "../../services/tournamentService.js";
import {
  notifyRegistrationConfirmed,
  notifyRegistrationRejected,
} from "../../services/notificationService.js";
import { safeEditMessageText } from "../../utils/messageHelpers.js";
import { bot } from "../instance.js";

export const adminParticipantCommands = new Composer<BotContext>();

// In-memory map: shortKey → { tournamentId, userId }
const pendingActionsMap = new Map<
  string,
  { tournamentId: string; userId: string }
>();

function generateKey(): string {
  return Math.random().toString(36).slice(2, 8);
}

function clearKeysForTournament(tournamentId: string): void {
  for (const [key, value] of pendingActionsMap.entries()) {
    if (value.tournamentId === tournamentId) {
      pendingActionsMap.delete(key);
    }
  }
}

async function showPendingList(
  ctx: BotContext,
  tournamentId: string,
  cachedTournament?: Awaited<ReturnType<typeof getTournament>>,
): Promise<void> {
  const tournament = cachedTournament ?? (await getTournament(tournamentId));
  if (!tournament) {
    await ctx.answerCallbackQuery({
      text: "Турнир не найден",
      show_alert: true,
    });
    return;
  }

  const pending = await db
    .select({
      userId: tournamentParticipants.userId,
      username: users.username,
      name: users.name,
    })
    .from(tournamentParticipants)
    .innerJoin(users, eq(tournamentParticipants.userId, users.id))
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        eq(tournamentParticipants.status, "pending"),
      ),
    );

  // Clear old keys for this tournament and populate fresh ones
  clearKeysForTournament(tournamentId);

  if (pending.length === 0) {
    await ctx.answerCallbackQuery({ text: "Нет ожидающих участников" });
    await safeEditMessageText(ctx, {
      text: `*${tournament.name}*\n\nНет участников, ожидающих подтверждения.`,
      parse_mode: "Markdown",
    });
    return;
  }

  const keyboard = new InlineKeyboard();
  let message = `*${tournament.name}*\nОжидают подтверждения: ${pending.length}\n\n`;

  for (const participant of pending) {
    const displayName = participant.name ?? participant.username ?? "Игрок";
    const handle = participant.username ? ` (@${participant.username})` : "";
    message += `${displayName}${handle}\n`;

    const key = generateKey();
    pendingActionsMap.set(key, { tournamentId, userId: participant.userId });

    keyboard
      .text("✅ Подтвердить", `adm:c:${key}`)
      .text("❌ Отклонить", `adm:r:${key}`)
      .row();
  }

  await ctx.answerCallbackQuery();
  await safeEditMessageText(ctx, {
    text: message,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

// Show pending participants list for a tournament
adminParticipantCommands.callbackQuery(
  /^adm:pending_list:(.+)$/,
  async (ctx) => {
    if (ctx.dbUser.role !== "admin") {
      await ctx.answerCallbackQuery({
        text: "Нет доступа",
        show_alert: true,
      });
      return;
    }

    const tournamentId = ctx.match![1]!;
    await showPendingList(ctx, tournamentId);
  },
);

// Confirm participant
adminParticipantCommands.callbackQuery(/^adm:c:(.+)$/, async (ctx) => {
  if (ctx.dbUser.role !== "admin") {
    await ctx.answerCallbackQuery({ text: "Нет доступа", show_alert: true });
    return;
  }

  const key = ctx.match![1]!;
  const entry = pendingActionsMap.get(key);

  if (!entry) {
    await ctx.answerCallbackQuery({
      text: "Список устарел. Откройте снова.",
      show_alert: true,
    });
    return;
  }

  const { tournamentId, userId } = entry;
  const tournament = await getTournament(tournamentId);
  const updated = await confirmParticipant(tournamentId, userId);

  if (updated && tournament) {
    await notifyRegistrationConfirmed(
      bot.api,
      userId,
      tournamentId,
      tournament.name,
    );
  }

  await showPendingList(ctx, tournamentId, tournament);
});

// Reject participant
adminParticipantCommands.callbackQuery(/^adm:r:(.+)$/, async (ctx) => {
  if (ctx.dbUser.role !== "admin") {
    await ctx.answerCallbackQuery({ text: "Нет доступа", show_alert: true });
    return;
  }

  const key = ctx.match![1]!;
  const entry = pendingActionsMap.get(key);

  if (!entry) {
    await ctx.answerCallbackQuery({
      text: "Список устарел. Откройте снова.",
      show_alert: true,
    });
    return;
  }

  const { tournamentId, userId } = entry;
  const tournament = await getTournament(tournamentId);
  const updated = await rejectParticipant(tournamentId, userId);

  if (updated && tournament) {
    await notifyRegistrationRejected(
      bot.api,
      userId,
      tournamentId,
      tournament.name,
    );
  }

  await showPendingList(ctx, tournamentId, tournament);
});
