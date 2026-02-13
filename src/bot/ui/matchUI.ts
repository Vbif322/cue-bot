import { InlineKeyboard } from "grammy";
import type { tournaments } from "../../db/schema.js";
import {
  getRoundName,
  calculateRounds,
  getNextPowerOfTwo,
} from "../../services/bracketGenerator.js";
import type { Tournament } from "../@types/tournament.js";
import type { MatchWithPlayers } from "../@types/match.js";

/**
 * Format player name for display
 */
export function formatPlayerName(
  username: string | null,
  name: string | null,
): string {
  if (username) return `@${username}`;
  if (name) return name;
  return "Участник";
}

/**
 * Get match status emoji
 */
export function getMatchStatusEmoji(status: string): string {
  switch (status) {
    case "scheduled":
      return "⏳";
    case "in_progress":
      return "🎱";
    case "pending_confirmation":
      return "⏸️";
    case "completed":
      return "✅";
    case "cancelled":
      return "❌";
    default:
      return "❓";
  }
}

/**
 * Format match card
 */
export function formatMatchCard(
  match: MatchWithPlayers,
  tournament: Tournament,
): string {
  const player1 = formatPlayerName(
    match.player1Username ?? null,
    match.player1Name ?? null,
  );
  const player2 = formatPlayerName(
    match.player2Username ?? null,
    match.player2Name ?? null,
  );

  const rounds = calculateRounds(
    getNextPowerOfTwo(
      tournament.confirmedParticipants ?? tournament.maxParticipants,
    ),
  );
  const roundName = getRoundName(
    match.round,
    rounds,
    tournament.format,
    match.bracketType || "winners",
  );

  let text = `🎱 *Матч #${match.position}*\n`;
  text += `${roundName}\n\n`;
  text += `${player1}\n`;
  text += `vs\n`;
  text += `${player2}\n\n`;

  if (match.status === "completed" || match.status === "pending_confirmation") {
    text += `Счёт: ${match.player1Score ?? 0} : ${match.player2Score ?? 0}\n`;
  }

  if (match.winnerId && match.status === "completed") {
    const winnerName = formatPlayerName(
      match.winnerUsername ?? null,
      match.winnerName ?? null,
    );
    text += `Победитель: ${winnerName}\n`;
  }

  text += `\nСтатус: ${getMatchStatusEmoji(match.status)} `;
  switch (match.status) {
    case "scheduled":
      text += "Ожидает начала";
      break;
    case "in_progress":
      text += "В процессе";
      break;
    case "pending_confirmation":
      text += "Ожидает подтверждения";
      break;
    case "completed":
      text += "Завершён";
      break;
    case "cancelled":
      text += "Отменён";
      break;
  }

  if (match.isTechnicalResult) {
    text += `\n⚠️ Технический результат: ${match.technicalReason || "не указана причина"}`;
  }

  return text;
}

/**
 * Get keyboard for match based on user role and match status
 */
export function getMatchKeyboard(
  match: MatchWithPlayers,
  userId: string,
  tournament: typeof tournaments.$inferSelect,
  isAdminUser: boolean,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const isPlayer1 = match.player1Id === userId;
  const isPlayer2 = match.player2Id === userId;
  const isParticipant = isPlayer1 || isPlayer2;

  // Match in progress - allow reporting result
  if (match.status === "in_progress" && isParticipant) {
    keyboard.text("📝 Внести результат", `match:report:${match.id}`).row();
  }

  // Scheduled match - allow starting (if both players are set)
  if (
    match.status === "scheduled" &&
    match.player1Id &&
    match.player2Id &&
    isParticipant
  ) {
    keyboard.text("▶️ Начать матч", `match:start:${match.id}`).row();
  }

  // Pending confirmation - show confirm/dispute for opponent
  if (match.status === "pending_confirmation" && isParticipant) {
    if (match.reportedBy !== userId) {
      // This is the opponent who needs to confirm
      keyboard
        .text("✅ Подтвердить", `match:confirm:${match.id}`)
        .text("❌ Оспорить", `match:dispute:${match.id}`)
        .row();
    } else {
      keyboard
        .text("⏳ Ожидание подтверждения...", `match:waiting:${match.id}`)
        .row();
    }
  }

  // Admin/referee can set technical result
  if (
    isAdminUser &&
    match.status !== "completed" &&
    match.status !== "cancelled"
  ) {
    keyboard.text("⚙️ Тех. результат", `match:tech:${match.id}`).row();
  }

  // Back to bracket
  keyboard.text("📊 К сетке", `bracket:view:${match.tournamentId}`).row();

  return keyboard;
}
