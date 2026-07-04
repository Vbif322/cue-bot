import { eq, and } from 'drizzle-orm';
import type { Api, InlineKeyboard } from 'grammy';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import {
  notifications,
  users,
  tournaments,
  tournamentParticipants,
  matches,
} from '@/db/schema.js';
import type { INotification } from '@/db/schema.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import {
  formatPlayerName,
  getResultConfirmKeyboard,
  getMatchNotificationKeyboard,
} from '@/bot/ui/matchUI.js';
import { escapeMarkdown } from '@/utils/messageHelpers.js';
import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';

type NotificationType = (typeof notifications.$inferInsert)['type'];

/**
 * Extract both players' display names from a match in one call. Each name is
 * produced by `formatPlayerName`, so it is already Markdown-safe — do NOT pass
 * the result through `escapeMarkdown` again.
 */
function playerNamesOf(match: MatchWithPlayers): {
  player1Name: string;
  player2Name: string;
} {
  return {
    player1Name: formatPlayerName({
      username: match.player1Username ?? null,
      name: match.player1Name,
      surname: match.player1Surname,
      telegramId: match.player1TelegramId,
    }),
    player2Name: formatPlayerName({
      username: match.player2Username ?? null,
      name: match.player2Name,
      surname: match.player2Surname,
      telegramId: match.player2TelegramId,
    }),
  };
}

/**
 * Send a per-player notification to both players of a match. Empty slots (TBD
 * bracket positions) and `skipUserId` are skipped. `build` receives the target
 * player's id, their opponent's (Markdown-safe) name, and whether they are
 * player 1, and returns the notification's type/title/message. Players are
 * notified in `player1, player2` order.
 */
async function notifyBothPlayers(
  api: Api,
  match: MatchWithPlayers,
  build: (ctx: {
    playerId: UUID;
    opponentName: string;
    isPlayer1: boolean;
  }) => { type: NotificationType; title: string; message: string },
  options: { keyboard?: InlineKeyboard; skipUserId?: string } = {},
): Promise<void> {
  const { player1Name, player2Name } = playerNamesOf(match);

  for (const playerId of [match.player1Id, match.player2Id]) {
    if (!playerId) continue;
    if (options.skipUserId && playerId === options.skipUserId) continue;

    const isPlayer1 = playerId === match.player1Id;
    const opponentName = isPlayer1 ? player2Name : player1Name;
    const data = build({ playerId, opponentName, isPlayer1 });

    await createAndSendNotification(
      api,
      {
        userId: playerId,
        type: data.type,
        title: data.title,
        message: data.message,
        tournamentId: match.tournamentId,
        matchId: match.id,
      },
      options.keyboard,
    );
  }
}

/**
 * Create a notification record in the database
 */
export async function createNotification(data: {
  userId: UUID;
  type: NotificationType;
  title: string;
  message: string;
  tournamentId?: UUID;
  matchId?: UUID;
}): Promise<UUID> {
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

  if (!notification) {
    throw new Error('Failed to create notification');
  }

  return notification.id;
}

/**
 * Send a notification to a user via Telegram
 */
export async function sendNotification(
  api: Api,
  notificationId: UUID,
  keyboard?: InlineKeyboard,
): Promise<boolean> {
  const notification = await db.query.notifications.findFirst({
    where: eq(notifications.id, notificationId),
  });

  if (!notification) return false;

  const user = await db.query.users.findFirst({
    where: eq(users.id, notification.userId),
  });

  if (!user?.telegram_id) {
    return false;
  }

  const isDevMockUser =
    process.env.NODE_ENV === 'development' && user.username.includes('mock');

  try {
    if (!isDevMockUser) {
      await api.sendMessage(
        user.telegram_id,
        `*${notification.title}*\n\n${notification.message}`,
        {
          parse_mode: 'Markdown',
          ...(keyboard ? { reply_markup: keyboard } : {}),
        },
      );
    }

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
  api: Api,
  data: {
    userId: UUID;
    type: NotificationType;
    title: string;
    message: string;
    tournamentId?: UUID;
    matchId?: UUID;
  },
  keyboard?: InlineKeyboard,
): Promise<boolean> {
  const notificationId = await createNotification(data);

  return sendNotification(api, notificationId, keyboard);
}

/**
 * Notify about match assignment
 */
export async function notifyMatchAssigned(
  api: Api,
  match: MatchWithPlayers,
  tournamentName: string,
): Promise<void> {
  const safeName = escapeMarkdown(tournamentName);

  await notifyBothPlayers(
    api,
    match,
    ({ opponentName }) => ({
      type: 'bracket_formed',
      title: 'Назначен матч',
      message: `Турнир: ${safeName}\n` + `Ваш соперник: ${opponentName}`,
    }),
    { keyboard: getMatchNotificationKeyboard(match, { action: 'start' }) },
  );
}

/**
 * Notify both players that their match has been scheduled for a date/time.
 * Reuses the `match_reminder` notification type. Players with an empty slot
 * (TBD bracket position) are skipped — there is no one to notify yet.
 */
export async function notifyMatchScheduled(
  api: Api,
  match: MatchWithPlayers,
  tournamentName: string,
  scheduledAt: Date,
): Promise<void> {
  const when = DateTimeHelperInstance.formatDate(scheduledAt);
  const safeName = escapeMarkdown(tournamentName);

  await notifyBothPlayers(
    api,
    match,
    ({ opponentName }) => ({
      type: 'match_reminder',
      title: 'Матч назначен',
      message:
        `Турнир: ${safeName}\n` +
        `Соперник: ${opponentName}\n` +
        `Дата и время: ${when}`,
    }),
    { keyboard: getMatchNotificationKeyboard(match) },
  );
}

/**
 * Notify match start
 */
export async function notifyMatchStart(
  api: Api,
  match: MatchWithPlayers,
  tournamentName: string,
  startedBy: string,
): Promise<void> {
  const safeName = escapeMarkdown(tournamentName);

  await notifyBothPlayers(
    api,
    match,
    ({ opponentName }) => ({
      type: 'match_reminder',
      title: 'Матч!',
      message:
        `Турнир: ${safeName}\n` +
        `Ваш соперник: ${opponentName}\n\n` +
        `Начался матч!`,
    }),
    {
      keyboard: getMatchNotificationKeyboard(match, { action: 'report' }),
      skipUserId: startedBy,
    },
  );
}

/**
 * Notify about result pending confirmation
 */
export async function notifyResultPending(
  api: Api,
  match: MatchWithPlayers,
  reportedByUserId: UUID,
): Promise<void> {
  // Find opponent
  const opponentId =
    match.player1Id === reportedByUserId ? match.player2Id : match.player1Id;

  if (!opponentId) return;
  // TODO Писать в чью пользу счет
  const { player1Name, player2Name } = playerNamesOf(match);
  const reporterName =
    match.player1Id === reportedByUserId ? player1Name : player2Name;
  await createAndSendNotification(
    api,
    {
      userId: opponentId,
      type: 'result_confirmation_request',
      title: 'Подтвердите результат матча',
      message:
        `${reporterName} внёс результат: ${String(match.player1Score ?? '?')}:${String(match.player2Score ?? '?')}\n\n` +
        `Подтвердите или оспорьте результат.`,
      tournamentId: match.tournamentId,
      matchId: match.id,
    },
    getResultConfirmKeyboard(match.id),
  );
}

/**
 * Notify both players about confirmed result
 */
export async function notifyResultConfirmed(
  api: Api,
  match: MatchWithPlayers,
): Promise<void> {
  const winnerName = formatPlayerName({
    username: match.winnerUsername ?? null,
    name: match.winnerName,
    surname: match.winnerSurname,
    telegramId: match.winnerTelegramId,
  });

  const message =
    `Результат матча подтверждён!\n\n` +
    `Счёт: ${String(match.player1Score ?? '?')}:${String(match.player2Score ?? '?')}\n` +
    `Победитель: ${winnerName}`;

  await notifyBothPlayers(api, match, () => ({
    type: 'result_confirmed',
    title: 'Результат подтверждён',
    message,
  }));
}

/**
 * Notify both players about disputed result
 */
export async function notifyResultDisputed(
  api: Api,
  match: MatchWithPlayers,
  disputedByUserId: UUID,
): Promise<void> {
  const { player1Name, player2Name } = playerNamesOf(match);
  const disputerName =
    match.player1Id === disputedByUserId ? player1Name : player2Name;

  const message =
    `${disputerName} оспорил результат матча.\n\n` +
    `Матч возвращён в статус "в процессе".\n` +
    `Обратитесь к судье турнира для разрешения ситуации.`;

  await notifyBothPlayers(api, match, () => ({
    type: 'result_dispute',
    title: 'Результат оспорен',
    message,
  }));
}

/**
 * Notify about tournament completion
 */
export async function notifyTournamentCompleted(
  api: Api,
  tournamentId: UUID,
  winnerId: UUID,
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

  const participantIds = new Set<UUID>();
  for (const match of tournamentMatches) {
    if (match.player1Id) participantIds.add(match.player1Id);
    if (match.player2Id) participantIds.add(match.player2Id);
  }

  const safeName = escapeMarkdown(tournament.name);

  // Send notification to all participants
  for (const participantId of participantIds) {
    const isWinner = participantId === winnerId;

    await createAndSendNotification(api, {
      userId: participantId,
      type: 'tournament_results',
      title: isWinner ? 'Поздравляем с победой!' : 'Турнир завершён',
      message: isWinner
        ? `Вы победили в турнире "${safeName}"!`
        : `Турнир "${safeName}" завершён.\nПобедитель: ${winnerName}`,
      tournamentId,
    });
  }
}

/**
 * Notify confirmed participants that a tournament has been cancelled. Uses the
 * participant roster (not match players) as the source of truth so it works on
 * every stage — before the bracket exists there are no matches yet.
 */
export async function notifyTournamentCancelled(
  api: Api,
  tournamentId: UUID,
  tournamentName: string,
): Promise<void> {
  const participants = await db.query.tournamentParticipants.findMany({
    where: and(
      eq(tournamentParticipants.tournamentId, tournamentId),
      eq(tournamentParticipants.status, 'confirmed'),
    ),
  });

  const safeName = escapeMarkdown(tournamentName);

  for (const participant of participants) {
    await createAndSendNotification(api, {
      userId: participant.userId,
      type: 'tournament_cancelled',
      title: 'Турнир отменён',
      message: `Турнир "${safeName}" отменён администратором.`,
      tournamentId,
    });
  }
}

/**
 * Notify about disqualification
 */
export async function notifyDisqualification(
  api: Api,
  userId: UUID,
  tournamentId: UUID,
  reason: string,
): Promise<void> {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  const safeName = escapeMarkdown(tournament?.name ?? 'Неизвестный');
  const safeReason = escapeMarkdown(reason);

  await createAndSendNotification(api, {
    userId,
    type: 'disqualification',
    title: 'Дисквалификация',
    message:
      `Вы были дисквалифицированы из турнира "${safeName}".\n\n` +
      `Причина: ${safeReason}`,
    tournamentId,
  });
}

/**
 * Notify participant that their registration was confirmed by admin
 */
export async function notifyRegistrationConfirmed(
  api: Api,
  userId: string,
  tournamentId: string,
  tournamentName: string,
): Promise<void> {
  await createAndSendNotification(api, {
    userId: userId as UUID,
    type: 'registration_confirmed',
    title: 'Регистрация подтверждена',
    message:
      `Ваша заявка на турнир "${escapeMarkdown(tournamentName)}" подтверждена администратором.\n\n` +
      `Используйте /my\\_tournaments для просмотра ваших турниров.`,
    tournamentId: tournamentId as UUID,
  });
}

/**
 * Notify participant that their registration was rejected by admin
 */
export async function notifyRegistrationRejected(
  api: Api,
  userId: string,
  tournamentId: string,
  tournamentName: string,
): Promise<void> {
  await createAndSendNotification(api, {
    userId: userId as UUID,
    type: 'registration_rejected',
    title: 'Заявка отклонена',
    message: `Ваша заявка на турнир "${escapeMarkdown(tournamentName)}" была отклонена администратором.`,
    tournamentId: tournamentId as UUID,
  });
}

/**
 * Mark a single notification as read. Scoped by owner (`userId`) — без этого
 * фильтра любой аутентифицированный пользователь мог бы прочитать чужое
 * уведомление (IDOR). Возвращает `true`, если строка обновлена (уведомление
 * существует и принадлежит пользователю), иначе `false`.
 */
export async function markAsRead(
  notificationId: UUID,
  userId: UUID,
): Promise<boolean> {
  const updated = await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
      ),
    )
    .returning({ id: notifications.id });

  return updated.length > 0;
}

/**
 * Mark all of a user's unread notifications as read.
 */
export async function markAllAsRead(userId: UUID): Promise<void> {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false),
      ),
    );
}

/**
 * Get a user's notifications, newest first, with pagination. `unreadOnly`
 * ограничивает выборку непрочитанными.
 */
export async function getNotifications(
  userId: UUID,
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<INotification[]> {
  const { limit = 50, unreadOnly = false } = options;

  return db.query.notifications.findMany({
    where: unreadOnly
      ? and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
        )
      : eq(notifications.userId, userId),
    orderBy: (n, { desc }) => [desc(n.createdAt)],
    limit,
  });
}

/**
 * Get unread notifications for user
 */
export async function getUnreadNotifications(
  userId: UUID,
): Promise<INotification[]> {
  return db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false),
    ),
    orderBy: (n, { desc }) => [desc(n.createdAt)],
    limit: 20,
  });
}
