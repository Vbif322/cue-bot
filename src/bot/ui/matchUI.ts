import { InlineKeyboard } from 'grammy';
import type { tournaments } from '../../db/schema.js';
import {
  getRoundName,
  calculateRounds,
  getNextPowerOfTwo,
} from '../../services/bracketGenerator.js';
import { escapeMarkdown, formatFullName } from '../../utils/messageHelpers.js';
import { DateTimeHelperInstance } from '../../utils/dateTimeHelper.js';
import type { Tournament } from '../@types/tournament.js';
import type { MatchWithPlayers } from '../@types/match.js';

export interface PlayerNameParts {
  username: string | null;
  name?: string | null | undefined;
  surname?: string | null | undefined;
  telegramId?: string | null | undefined;
}

/**
 * Format player name for display.
 *
 * Shows «Имя Фамилия» (falling back to `@username`, then «Участник»). In
 * Markdown contexts the name is rendered as a clickable link to the player's
 * Telegram profile via `tg://user?id=<telegramId>` when the id is known;
 * otherwise it degrades to a clickable `@username` mention or plain text.
 *
 * The returned string is Markdown-safe (escaped) — do NOT pass it through
 * `escapeMarkdown` again.
 *
 * Pass `{ markdown: false }` for plain-text contexts like inline button
 * labels (no Markdown parsing, no links). Pass `{ link: false }` to keep
 * Markdown formatting but suppress the profile link.
 */
export function formatPlayerName(
  player: PlayerNameParts | null | undefined,
  options: { markdown?: boolean; link?: boolean } = {},
): string {
  const { markdown = true, link = true } = options;
  const username = player?.username ?? null;
  const fullName = formatFullName(player?.name, player?.surname);
  const displayText = fullName ?? username ?? 'Участник';

  if (!markdown) return displayText;
  if (link && player?.telegramId) {
    return `[${escapeMarkdown(displayText)}](tg://user?id=${player.telegramId})`;
  }
  if (!fullName && username) return `@${escapeMarkdown(username)}`;
  return escapeMarkdown(displayText);
}

/**
 * Get match status emoji
 */
export function getMatchStatusEmoji(status: string): string {
  switch (status) {
    case 'scheduled':
      return '⏳';
    case 'in_progress':
      return '🎱';
    case 'pending_confirmation':
      return '⏸️';
    case 'completed':
      return '✅';
    case 'cancelled':
      return '❌';
    default:
      return '❓';
  }
}

/**
 * Format match card
 */
export function formatMatchCard(
  match: MatchWithPlayers,
  tournament: Tournament,
): string {
  const player1 = formatPlayerName({
    username: match.player1Username ?? null,
    name: match.player1Name,
    surname: match.player1Surname,
    telegramId: match.player1TelegramId,
  });
  const player2 = formatPlayerName({
    username: match.player2Username ?? null,
    name: match.player2Name,
    surname: match.player2Surname,
    telegramId: match.player2TelegramId,
  });

  const rounds = calculateRounds(
    getNextPowerOfTwo(
      tournament.confirmedParticipants ?? tournament.maxParticipants,
    ),
  );
  const roundName = getRoundName(
    match.round,
    rounds,
    tournament.format,
    match.bracketType || 'winners',
  );

  let text = `🎱 *Матч #${match.position}*\n`;
  text += `${roundName}\n\n`;
  text += `${player1}\n`;
  text += `vs\n`;
  text += `${player2}\n\n`;

  if (match.status === 'completed' || match.status === 'pending_confirmation') {
    text += `Счёт: ${match.player1Score ?? 0} : ${match.player2Score ?? 0}\n`;
  }

  if (match.winnerId && match.status === 'completed') {
    const winnerName = formatPlayerName({
      username: match.winnerUsername ?? null,
      name: match.winnerName,
      surname: match.winnerSurname,
      telegramId: match.winnerTelegramId,
    });
    text += `Победитель: ${winnerName}\n`;
  }

  text += `\nСтатус: ${getMatchStatusEmoji(match.status)} `;
  switch (match.status) {
    case 'scheduled':
      text += 'Ожидает начала';
      break;
    case 'in_progress':
      text += 'В процессе';
      break;
    case 'pending_confirmation':
      text += 'Ожидает подтверждения';
      break;
    case 'completed':
      text += 'Завершён';
      break;
    case 'cancelled':
      text += 'Отменён';
      break;
  }

  if (match.scheduledAt) {
    text += `\n🗓 Назначено: ${DateTimeHelperInstance.formatDate(match.scheduledAt)}`;
  }

  if (match.isTechnicalResult) {
    text += `\n⚠️ Технический результат: ${match.technicalReason || 'не указана причина'}`;
  }

  return text;
}

/**
 * Inline keyboard with the «✅ Подтвердить» / «❌ Оспорить» buttons used for
 * confirming a reported match result. Single source of truth for labels and
 * callback_data — reused by the result-pending Telegram notification.
 */
export function getResultConfirmKeyboard(matchId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Подтвердить', `match:confirm:${matchId}`)
    .text('❌ Оспорить', `match:dispute:${matchId}`);
}

/**
 * Get keyboard for match based on user role and match status
 */
export function getMatchKeyboard(
  match: MatchWithPlayers,
  userId: string,
  tournament: typeof tournaments.$inferSelect,
  canManage: boolean,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const isPlayer1 = match.player1Id === userId;
  const isPlayer2 = match.player2Id === userId;
  const isParticipant = isPlayer1 || isPlayer2;

  // Match in progress - allow reporting result
  if (match.status === 'in_progress' && isParticipant) {
    keyboard.text('📝 Внести результат', `match:report:${match.id}`).row();
  }

  // Scheduled match - allow starting (if both players are set)
  if (
    match.status === 'scheduled' &&
    match.player1Id &&
    match.player2Id &&
    isParticipant
  ) {
    keyboard.text('▶️ Начать матч', `match:start:${match.id}`).row();
  }

  // Pending confirmation - show confirm/dispute for opponent
  if (match.status === 'pending_confirmation' && isParticipant) {
    if (match.reportedBy !== userId) {
      keyboard
        .text('✅ Подтвердить', `match:confirm:${match.id}`)
        .text('❌ Оспорить', `match:dispute:${match.id}`)
        .row();
    } else {
      keyboard
        .text('⏳ Ожидание подтверждения...', `match:waiting:${match.id}`)
        .row();
    }
  }

  // Admin/referee can set technical result
  if (
    canManage &&
    match.status !== 'completed' &&
    match.status !== 'cancelled'
  ) {
    keyboard.text('⚙️ Тех. результат', `match:tech:${match.id}`).row();
  }

  // Per-match scheduling: admin/referee assigns this match's date & time.
  if (
    canManage &&
    tournament.scheduleMode === 'per_match' &&
    match.status !== 'completed' &&
    match.status !== 'cancelled'
  ) {
    keyboard.text('🗓 Назначить время', `msch:set:${match.id}`).row();
    if (match.scheduledAt) {
      keyboard.text('🗓 Сбросить время', `msch:clear:${match.id}`).row();
    }
  }

  // Back to bracket
  keyboard.text('📊 К сетке', `bracket:view:${match.tournamentId}`).row();

  return keyboard;
}
