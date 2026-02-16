import { eq, and } from "drizzle-orm";
import { Bot } from "grammy";
import { db } from "../db/db.js";
import { notifications, users, tournaments, matches } from "../db/schema.js";
import type { BotContext } from "../bot/types.js";
import type { MatchWithPlayers } from "../bot/@types/match.js";

type NotificationType = (typeof notifications.$inferInsert)["type"];

/**
 * Create a notification record in the database
 */
export async function createNotification(data: {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  tournamentId?: string;
  matchId?: string;
}): Promise<string> {
  const [notification] = await db
    .insert(notifications)
    .values({
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      tournamentId: data.tournamentId,
      matchId: data.matchId,
    })
    .returning({ id: notifications.id });

  return notification?.id ?? "";
}

/**
 * Send a notification to a user via Telegram
 */
export async function sendNotification(
  bot: Bot<BotContext>,
  notificationId: string,
): Promise<boolean> {
  const notification = await db.query.notifications.findFirst({
    where: eq(notifications.id, notificationId),
  });

  if (!notification) return false;

  const user = await db.query.users.findFirst({
    where: eq(users.id, notification.userId),
  });

  if (!user || !user.telegram_id) return false;
  console.log(`*${notification.title}*\n\n${notification.message}`);
  try {
    await bot.api.sendMessage(
      user.telegram_id,
      `*${notification.title}*\n\n${notification.message}`,
      { parse_mode: "Markdown" },
    );

    await db
      .update(notifications)
      .set({ isSent: true, sentAt: new Date() })
      .where(eq(notifications.id, notificationId));

    return true;
  } catch (error) {
    console.error(`Failed to send notification ${notificationId}:`, error);
    return false;
  }
}

/**
 * Create and send notification
 */
export async function createAndSendNotification(
  bot: Bot<BotContext>,
  data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    tournamentId?: string;
    matchId?: string;
  },
): Promise<boolean> {
  const notificationId = await createNotification(data);
  return sendNotification(bot, notificationId);
}

/**
 * Notify about match assignment
 */
export async function notifyMatchAssigned(
  bot: Bot<BotContext>,
  match: MatchWithPlayers,
  tournamentName: string,
): Promise<void> {
  const player1Name = match.player1Username
    ? `@${match.player1Username}`
    : match.player1Name || "Участник";
  const player2Name = match.player2Username
    ? `@${match.player2Username}`
    : match.player2Name || "Участник";

  // Notify player 1
  if (match.player1Id) {
    await createAndSendNotification(bot, {
      userId: match.player1Id,
      type: "bracket_formed",
      title: "Назначен матч",
      message:
        `Турнир: ${tournamentName}\n` +
        `Ваш соперник: ${player2Name}\n\n` +
        `Используйте /my\\_match для просмотра деталей.`,
      tournamentId: match.tournamentId,
      matchId: match.id,
    });
  }

  // Notify player 2
  if (match.player2Id) {
    await createAndSendNotification(bot, {
      userId: match.player2Id,
      type: "bracket_formed",
      title: "Назначен матч",
      message:
        `Турнир: ${tournamentName}\n` +
        `Ваш соперник: ${player1Name}\n\n` +
        `Используйте /my\\_match для просмотра деталей.`,
      tournamentId: match.tournamentId,
      matchId: match.id,
    });
  }
}
// }
/**
 * Notify match start
 */
export async function notifyMatchStart(
  bot: Bot<BotContext>,
  match: MatchWithPlayers,
  tournamentName: string,
  startedBy: string,
): Promise<void> {
  const player1Name = match.player1Username
    ? `@${match.player1Username}`
    : match.player1Name || "Участник";
  const player2Name = match.player2Username
    ? `@${match.player2Username}`
    : match.player2Name || "Участник";

  for (const playerId of [match.player1Id, match.player2Id]) {
    if (!playerId || playerId === startedBy) continue;

    const opponentName =
      playerId === match.player1Id ? player2Name : player1Name;

    await createAndSendNotification(bot, {
      userId: playerId,
      type: "match_reminder",
      title: "Матч!",
      message:
        `Турнир: ${tournamentName}\n` +
        `Ваш соперник: ${opponentName}\n\n` +
        `Начался матч!`,
      tournamentId: match.tournamentId,
      matchId: match.id,
    });
  }
}

/**
 * Notify about result pending confirmation
 */
export async function notifyResultPending(
  bot: Bot<BotContext>,
  match: MatchWithPlayers,
  reportedByUserId: string,
): Promise<void> {
  // Find opponent
  const opponentId =
    match.player1Id === reportedByUserId ? match.player2Id : match.player1Id;
  console.log(opponentId);
  if (!opponentId) return;

  const reporterName =
    match.player1Id === reportedByUserId
      ? match.player1Username
        ? `@${match.player1Username}`
        : match.player1Name || "Соперник"
      : match.player2Username
        ? `@${match.player2Username}`
        : match.player2Name || "Соперник";
  await createAndSendNotification(bot, {
    userId: opponentId,
    type: "result_confirmation_request",
    title: "Подтвердите результат матча",
    message:
      `${reporterName} внёс результат: ${match.player1Score}:${match.player2Score}\n\n` +
      `Подтвердите или оспорьте результат.\n` +
      `Используйте /my\\_match для просмотра`,
    tournamentId: match.tournamentId,
    matchId: match.id,
  });
}

/**
 * Notify both players about confirmed result
 */
export async function notifyResultConfirmed(
  bot: Bot<BotContext>,
  match: MatchWithPlayers,
  tournamentName: string,
): Promise<void> {
  const winnerName = match.winnerUsername
    ? `@${match.winnerUsername}`
    : match.winnerName || "Победитель";

  const message =
    `Результат матча подтверждён!\n\n` +
    `Счёт: ${match.player1Score}:${match.player2Score}\n` +
    `Победитель: ${winnerName}`;

  // Notify both players
  for (const playerId of [match.player1Id, match.player2Id]) {
    if (!playerId) continue;

    await createAndSendNotification(bot, {
      userId: playerId,
      type: "result_confirmed",
      title: "Результат подтверждён",
      message,
      tournamentId: match.tournamentId,
      matchId: match.id,
    });
  }
}

/**
 * Notify both players about disputed result
 */
export async function notifyResultDisputed(
  bot: Bot<BotContext>,
  match: MatchWithPlayers,
  disputedByUserId: string,
): Promise<void> {
  const disputerName =
    match.player1Id === disputedByUserId
      ? match.player1Username
        ? `@${match.player1Username}`
        : match.player1Name || "Игрок"
      : match.player2Username
        ? `@${match.player2Username}`
        : match.player2Name || "Игрок";

  const message =
    `${disputerName} оспорил результат матча.\n\n` +
    `Матч возвращён в статус "в процессе".\n` +
    `Обратитесь к судье турнира для разрешения ситуации.`;

  // Notify both players
  for (const playerId of [match.player1Id, match.player2Id]) {
    if (!playerId) continue;

    await createAndSendNotification(bot, {
      userId: playerId,
      type: "result_dispute",
      title: "Результат оспорен",
      message,
      tournamentId: match.tournamentId,
      matchId: match.id,
    });
  }
}

/**
 * Notify about tournament completion
 */
export async function notifyTournamentCompleted(
  bot: Bot<BotContext>,
  tournamentId: string,
  winnerId: string,
  winnerName: string,
): Promise<void> {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) return;

  // Get unique participant IDs from matches
  const tournamentMatches = await db.query.matches.findMany({
    where: eq(matches.tournamentId, tournamentId),
  });

  const participantIds = new Set<string>();
  for (const match of tournamentMatches) {
    if (match.player1Id) participantIds.add(match.player1Id);
    if (match.player2Id) participantIds.add(match.player2Id);
  }

  // Send notification to all participants
  for (const oderId of participantIds) {
    const isWinner = oderId === winnerId;

    await createAndSendNotification(bot, {
      userId: oderId,
      type: "tournament_results",
      title: isWinner ? "Поздравляем с победой!" : "Турнир завершён",
      message: isWinner
        ? `Вы победили в турнире "${tournament.name}"!`
        : `Турнир "${tournament.name}" завершён.\nПобедитель: ${winnerName}`,
      tournamentId,
    });
  }
}

/**
 * Notify about disqualification
 */
export async function notifyDisqualification(
  bot: Bot<BotContext>,
  userId: string,
  tournamentId: string,
  reason: string,
): Promise<void> {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  await createAndSendNotification(bot, {
    userId,
    type: "disqualification",
    title: "Дисквалификация",
    message:
      `Вы были дисквалифицированы из турнира "${tournament?.name || "Неизвестный"}".\n\n` +
      `Причина: ${reason}`,
    tournamentId,
  });
}

/**
 * Send match reminder
 */
export async function sendMatchReminder(
  bot: Bot<BotContext>,
  match: MatchWithPlayers,
  tournamentName: string,
): Promise<void> {
  const player1Name = match.player1Username
    ? `@${match.player1Username}`
    : match.player1Name || "Участник";
  const player2Name = match.player2Username
    ? `@${match.player2Username}`
    : match.player2Name || "Участник";

  for (const playerId of [match.player1Id, match.player2Id]) {
    if (!playerId) continue;

    const opponentName =
      playerId === match.player1Id ? player2Name : player1Name;

    await createAndSendNotification(bot, {
      userId: playerId,
      type: "match_reminder",
      title: "Напоминание о матче",
      message:
        `Турнир: ${tournamentName}\n` +
        `Ваш соперник: ${opponentName}\n\n` +
        `Не забудьте сыграть матч и внести результат!`,
      tournamentId: match.tournamentId,
      matchId: match.id,
    });
  }
}

/**
 * Mark notification as read
 */
export async function markAsRead(notificationId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, notificationId));
}

/**
 * Get unread notifications for user
 */
export async function getUnreadNotifications(userId: string) {
  return db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false),
    ),
    orderBy: (n, { desc }) => [desc(n.createdAt)],
    limit: 20,
  });
}
