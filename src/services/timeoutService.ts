import { and, eq, lt, inArray } from "drizzle-orm";
import { Bot } from "grammy";
import { db } from "../db/db.js";
import { matches, tournaments } from "../db/schema.js";
import type { BotContext } from "../bot/types.js";
import { getMatch, setTechnicalResult } from "./matchService.js";
import { sendMatchReminder, createAndSendNotification } from "./notificationService.js";

export interface TimeoutConfig {
  resultSubmissionHours: number; // Time to submit result (default: 24)
  confirmationHours: number; // Time to confirm result (default: 12)
  reminderBeforeHours: number; // Hours before match to send reminder (default: 2)
  checkIntervalMinutes: number; // How often to check for timeouts (default: 30)
}

const DEFAULT_CONFIG: TimeoutConfig = {
  resultSubmissionHours: 24,
  confirmationHours: 12,
  reminderBeforeHours: 2,
  checkIntervalMinutes: 30,
};

let timeoutInterval: NodeJS.Timeout | null = null;
let botInstance: Bot<BotContext> | null = null;
let currentConfig: TimeoutConfig = DEFAULT_CONFIG;

/**
 * Start the timeout checker
 */
export function startTimeoutChecker(
  bot: Bot<BotContext>,
  config: Partial<TimeoutConfig> = {}
): void {
  botInstance = bot;
  currentConfig = { ...DEFAULT_CONFIG, ...config };

  // Stop existing interval if any
  if (timeoutInterval) {
    clearInterval(timeoutInterval);
  }

  // Run immediately and then at interval
  checkAllTimeouts();

  timeoutInterval = setInterval(
    checkAllTimeouts,
    currentConfig.checkIntervalMinutes * 60 * 1000
  );

  console.log(
    `Timeout checker started (interval: ${currentConfig.checkIntervalMinutes} min)`
  );
}

/**
 * Stop the timeout checker
 */
export function stopTimeoutChecker(): void {
  if (timeoutInterval) {
    clearInterval(timeoutInterval);
    timeoutInterval = null;
  }
  console.log("Timeout checker stopped");
}

/**
 * Check all timeouts
 */
async function checkAllTimeouts(): Promise<void> {
  if (!botInstance) return;

  try {
    await checkMatchReminders();
    await checkPendingConfirmations();
    await checkInProgressMatches();
  } catch (error) {
    console.error("Error checking timeouts:", error);
  }
}

/**
 * Check for matches that need reminders
 */
async function checkMatchReminders(): Promise<void> {
  if (!botInstance) return;

  const reminderThreshold = new Date();
  reminderThreshold.setHours(
    reminderThreshold.getHours() + currentConfig.reminderBeforeHours
  );

  // Find scheduled matches with scheduledAt within reminder window
  const matchesToRemind = await db.query.matches.findMany({
    where: and(
      eq(matches.status, "scheduled"),
      lt(matches.scheduledAt, reminderThreshold)
    ),
  });

  for (const match of matchesToRemind) {
    // Check if both players are set
    if (!match.player1Id || !match.player2Id) continue;

    const matchWithPlayers = await getMatch(match.id);
    if (!matchWithPlayers) continue;

    const tournament = await db.query.tournaments.findFirst({
      where: eq(tournaments.id, match.tournamentId),
    });

    if (tournament) {
      await sendMatchReminder(botInstance, matchWithPlayers, tournament.name);
    }
  }
}

/**
 * Check for matches pending confirmation that have timed out
 */
async function checkPendingConfirmations(): Promise<void> {
  if (!botInstance) return;

  const timeout = new Date();
  timeout.setHours(timeout.getHours() - currentConfig.confirmationHours);

  // Find matches pending confirmation longer than timeout
  const expiredMatches = await db.query.matches.findMany({
    where: and(
      eq(matches.status, "pending_confirmation"),
      lt(matches.updatedAt, timeout)
    ),
  });

  for (const match of expiredMatches) {
    // Auto-confirm the result if opponent hasn't responded
    // The reporter's result is accepted
    if (!match.winnerId || !match.reportedBy) continue;

    await db
      .update(matches)
      .set({
        status: "completed",
        confirmedBy: match.reportedBy, // Auto-confirm
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(matches.id, match.id));

    // Notify both players
    const matchWithPlayers = await getMatch(match.id);
    if (!matchWithPlayers) continue;

    const tournament = await db.query.tournaments.findFirst({
      where: eq(tournaments.id, match.tournamentId),
    });

    // Notify opponent about auto-confirmation
    const opponentId =
      match.player1Id === match.reportedBy ? match.player2Id : match.player1Id;

    if (opponentId) {
      await createAndSendNotification(botInstance, {
        userId: opponentId,
        type: "result_confirmed",
        title: "Результат автоматически подтверждён",
        message:
          `Результат матча был автоматически подтверждён из-за истечения времени ожидания.\n\n` +
          `Счёт: ${match.player1Score}:${match.player2Score}`,
        tournamentId: match.tournamentId,
        matchId: match.id,
      });
    }

    console.log(`Match ${match.id} auto-confirmed due to timeout`);
  }
}

/**
 * Check for in-progress matches that have been idle too long
 */
async function checkInProgressMatches(): Promise<void> {
  if (!botInstance) return;

  const timeout = new Date();
  timeout.setHours(timeout.getHours() - currentConfig.resultSubmissionHours);

  // Find matches in progress longer than timeout without result
  const idleMatches = await db.query.matches.findMany({
    where: and(
      eq(matches.status, "in_progress"),
      lt(matches.startedAt, timeout)
    ),
  });

  for (const match of idleMatches) {
    // Send reminder instead of auto-forfeit
    const matchWithPlayers = await getMatch(match.id);
    if (!matchWithPlayers) continue;

    const tournament = await db.query.tournaments.findFirst({
      where: eq(tournaments.id, match.tournamentId),
    });

    if (!tournament) continue;

    // Send reminder to both players
    for (const playerId of [match.player1Id, match.player2Id]) {
      if (!playerId) continue;

      await createAndSendNotification(botInstance, {
        userId: playerId,
        type: "match_result_pending",
        title: "Напоминание: внесите результат",
        message:
          `Матч в турнире "${tournament.name}" ожидает результата уже более ${currentConfig.resultSubmissionHours} часов.\n\n` +
          `Пожалуйста, внесите результат или обратитесь к судье.`,
        tournamentId: match.tournamentId,
        matchId: match.id,
      });
    }

    console.log(`Sent idle match reminder for match ${match.id}`);
  }
}

/**
 * Manually trigger timeout check
 */
export async function triggerTimeoutCheck(): Promise<void> {
  await checkAllTimeouts();
}

/**
 * Get current timeout configuration
 */
export function getTimeoutConfig(): TimeoutConfig {
  return { ...currentConfig };
}

/**
 * Update timeout configuration
 */
export function updateTimeoutConfig(config: Partial<TimeoutConfig>): void {
  currentConfig = { ...currentConfig, ...config };

  // Restart interval with new config
  if (botInstance && timeoutInterval) {
    stopTimeoutChecker();
    startTimeoutChecker(botInstance, currentConfig);
  }
}

/**
 * Assign technical loss due to timeout (for admin use)
 */
export async function assignTimeoutTechnicalLoss(
  matchId: string,
  loserId: string,
  adminId: string
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatch(matchId);
  if (!match) {
    return { success: false, error: "Матч не найден" };
  }

  // Determine winner (the other player)
  const winnerId =
    match.player1Id === loserId ? match.player2Id : match.player1Id;

  if (!winnerId) {
    return { success: false, error: "Невозможно определить победителя" };
  }

  return setTechnicalResult(matchId, winnerId, "Техническое поражение по таймауту", adminId);
}
