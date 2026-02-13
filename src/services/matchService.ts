import { and, eq, inArray, or, asc } from "drizzle-orm";
import { db } from "../db/db.js";
import { matches, tournaments, users } from "../db/schema.js";
import type { BracketMatch } from "./bracketGenerator.js";
import type { Match, MatchWithPlayers } from "../bot/@types/match.js";
import { completeTournament, getTournament } from "./tournamentService.js";

/**
 * Create matches in database from generated bracket
 */
export async function createMatches(
  tournamentId: string,
  bracket: BracketMatch[],
): Promise<void> {
  // First, create all matches without nextMatchId (we'll update later)
  const createdMatches: { position: number; id: string }[] = [];

  for (const match of bracket) {
    const [created] = await db
      .insert(matches)
      .values({
        tournamentId,
        round: match.round,
        position: match.position,
        player1Id: match.player1Id,
        player2Id: match.player2Id,
        bracketType: match.bracketType,
        status: determineInitialStatus(match),
      })
      .returning({ id: matches.id, position: matches.position });

    if (created) {
      createdMatches.push({ position: match.position, id: created.id });
    }
  }

  // Now update nextMatchId references
  for (const match of bracket) {
    if (match.nextMatchId !== undefined) {
      const currentMatch = createdMatches.find(
        (m) => m.position === match.position,
      );
      const nextMatch = createdMatches.find(
        (m) => m.position === match.nextMatchId,
      );

      if (currentMatch && nextMatch) {
        await db
          .update(matches)
          .set({ nextMatchId: nextMatch.id })
          .where(eq(matches.id, currentMatch.id));
      }
    }
  }
}

/**
 * Determine initial status for a match
 */
function determineInitialStatus(
  match: BracketMatch,
): (typeof matches.$inferSelect)["status"] {
  // If both players are set, match is ready to play
  if (match.player1Id && match.player2Id) {
    return "scheduled";
  }
  // If one player has BYE, they auto-advance (handled separately)
  // Otherwise, match is waiting for players from previous rounds
  return "scheduled";
}

/**
 * Get match by ID with player information
 */
export async function getMatch(
  matchId: string,
): Promise<MatchWithPlayers | null> {
  const result = await db
    .select({
      match: matches,
      player1Username: users.username,
      player1Name: users.name,
      player1TelegramId: users.telegram_id,
    })
    .from(matches)
    .leftJoin(users, eq(matches.player1Id, users.id))
    .where(eq(matches.id, matchId))
    .limit(1);

  const matchData = result[0];
  if (!matchData) return null;

  // Get player2 info
  let player2Username: string | null = null;
  let player2Name: string | null = null;
  let player2TelegramId: string | null = null;

  if (matchData.match.player2Id) {
    const player2 = await db.query.users.findFirst({
      where: eq(users.id, matchData.match.player2Id),
    });
    player2Username = player2?.username ?? null;
    player2Name = player2?.name ?? null;
    player2TelegramId = player2?.telegram_id ?? null;
  }

  // Get winner info
  let winnerUsername: string | null = null;
  let winnerName: string | null = null;
  let winnerTelegramId: string | null = null;

  if (matchData.match.winnerId) {
    const winner = await db.query.users.findFirst({
      where: eq(users.id, matchData.match.winnerId),
    });
    winnerUsername = winner?.username ?? null;
    winnerName = winner?.name ?? null;
    winnerTelegramId = winner?.telegram_id ?? null;
  }

  return {
    ...matchData.match,
    player1Username: matchData.player1Username,
    player1Name: matchData.player1Name,
    player1TelegramId: matchData.player1TelegramId,
    player2Username,
    player2Name,
    player2TelegramId,
    winnerUsername,
    winnerName,
    winnerTelegramId,
  };
}

/**
 * Get current active match for a player in a tournament
 */
export async function getPlayerCurrentMatch(
  tournamentId: string,
  userId: string,
): Promise<MatchWithPlayers | null> {
  const result = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, tournamentId),
        or(eq(matches.player1Id, userId), eq(matches.player2Id, userId)),
        inArray(matches.status, [
          "scheduled",
          "in_progress",
          "pending_confirmation",
        ]),
      ),
    )
    .orderBy(asc(matches.round))
    .limit(1);

  const firstMatch = result[0];
  if (!firstMatch) return null;

  return getMatch(firstMatch.id);
}

/**
 * Get all active matches for a player across all tournaments
 */
export async function getPlayerActiveMatches(
  userId: string,
): Promise<MatchWithPlayers[]> {
  const result = await db
    .select()
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .where(
      and(
        eq(tournaments.status, "in_progress"),
        or(eq(matches.player1Id, userId), eq(matches.player2Id, userId)),
        inArray(matches.status, [
          "scheduled",
          "in_progress",
          "pending_confirmation",
        ]),
      ),
    )
    .orderBy(asc(matches.round));

  const matchesWithPlayers: MatchWithPlayers[] = [];
  for (const r of result) {
    const match = await getMatch(r.matches.id);
    if (match) matchesWithPlayers.push(match);
  }

  return matchesWithPlayers;
}

/**
 * Get all matches for a tournament
 */
export async function getTournamentMatches(
  tournamentId: string,
): Promise<Match[]> {
  return db.query.matches.findMany({
    where: eq(matches.tournamentId, tournamentId),
    orderBy: [asc(matches.round), asc(matches.position)],
  });
}

/**
 * Get matches for a specific round
 */
export async function getRoundMatches(
  tournamentId: string,
  round: number,
  bracketType?: string,
): Promise<Match[]> {
  const conditions = [
    eq(matches.tournamentId, tournamentId),
    eq(matches.round, round),
  ];

  if (bracketType) {
    conditions.push(eq(matches.bracketType, bracketType));
  }

  return db.query.matches.findMany({
    where: and(...conditions),
    orderBy: [asc(matches.position)],
  });
}

/**
 * Report match result
 */
export async function reportResult(
  matchId: string,
  reporterId: string,
  player1Score: number,
  player2Score: number,
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatch(matchId);

  if (!match) {
    return { success: false, error: "Матч не найден" };
  }

  if (match.status === "completed") {
    return { success: false, error: "Матч уже завершён" };
  }

  if (match.status === "cancelled") {
    return { success: false, error: "Матч отменён" };
  }

  // Verify reporter is a participant
  if (match.player1Id !== reporterId && match.player2Id !== reporterId) {
    return { success: false, error: "Вы не являетесь участником этого матча" };
  }

  // Get tournament to check winScore
  const tournament = await getTournament(match.tournamentId);
  if (!tournament) {
    return { success: false, error: "Турнир не найден" };
  }

  // Validate score
  const winScore = tournament.winScore;
  if (player1Score !== winScore && player2Score !== winScore) {
    return {
      success: false,
      error: `Один из игроков должен набрать ${winScore} побед`,
    };
  }

  if (player1Score === winScore && player2Score === winScore) {
    return { success: false, error: "Оба игрока не могут выиграть" };
  }

  // Determine winner
  const winnerId =
    player1Score > player2Score ? match.player1Id : match.player2Id;

  // Update match
  await db
    .update(matches)
    .set({
      player1Score,
      player2Score,
      winnerId,
      reportedBy: reporterId,
      status: "pending_confirmation",
      updatedAt: new Date(),
    })
    .where(eq(matches.id, matchId));

  return { success: true };
}

/**
 * Confirm match result
 */
export async function confirmResult(
  matchId: string,
  confirmerId: string,
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatch(matchId);

  if (!match) {
    return { success: false, error: "Матч не найден" };
  }

  if (match.status !== "pending_confirmation") {
    return { success: false, error: "Матч не ожидает подтверждения" };
  }

  // Verify confirmer is the opponent (not the reporter)
  if (match.reportedBy === confirmerId) {
    return {
      success: false,
      error: "Вы не можете подтвердить свой собственный результат",
    };
  }

  if (match.player1Id !== confirmerId && match.player2Id !== confirmerId) {
    return { success: false, error: "Вы не являетесь участником этого матча" };
  }

  // Complete the match
  await db
    .update(matches)
    .set({
      status: "completed",
      confirmedBy: confirmerId,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(matches.id, matchId));

  // Advance winner to next match
  await advanceWinner(matchId);

  return { success: true };
}

/**
 * Dispute match result
 */
export async function disputeResult(
  matchId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatch(matchId);

  if (!match) {
    return { success: false, error: "Матч не найден" };
  }

  if (match.status !== "pending_confirmation") {
    return { success: false, error: "Матч не ожидает подтверждения" };
  }

  // Verify user is a participant
  if (match.player1Id !== userId && match.player2Id !== userId) {
    return { success: false, error: "Вы не являетесь участником этого матча" };
  }

  // Reset to in_progress for admin/referee intervention
  await db
    .update(matches)
    .set({
      status: "in_progress",
      player1Score: null,
      player2Score: null,
      winnerId: null,
      reportedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(matches.id, matchId));

  return { success: true };
}

/**
 * Set technical result for a match
 */
export async function setTechnicalResult(
  matchId: string,
  winnerId: string,
  reason: string,
  setById: string,
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatch(matchId);

  if (!match) {
    return { success: false, error: "Матч не найден" };
  }

  if (match.status === "completed" || match.status === "cancelled") {
    return { success: false, error: "Матч уже завершён или отменён" };
  }

  // Verify winner is a participant
  if (match.player1Id !== winnerId && match.player2Id !== winnerId) {
    return { success: false, error: "Победитель должен быть участником матча" };
  }

  // Get tournament winScore for technical result score
  const tournament = await getTournament(match.tournamentId);
  if (!tournament) {
    return { success: false, error: "Турнир не найден" };
  }

  const winScore = tournament.winScore;
  const player1Score = match.player1Id === winnerId ? winScore : 0;
  const player2Score = match.player2Id === winnerId ? winScore : 0;

  await db
    .update(matches)
    .set({
      player1Score,
      player2Score,
      winnerId,
      status: "completed",
      isTechnicalResult: true,
      technicalReason: reason,
      confirmedBy: setById,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(matches.id, matchId));

  // Advance winner
  await advanceWinner(matchId);

  return { success: true };
}

/**
 * Advance winner to next match
 */
export async function advanceWinner(matchId: string): Promise<void> {
  const match = await db.query.matches.findFirst({
    where: eq(matches.id, matchId),
  });

  if (!match || !match.winnerId) return;

  const tournament = await getTournament(match.tournamentId);
  if (!tournament) return;

  // Check if this is the final match
  if (!match.nextMatchId) {
    // Tournament is complete
    await completeTournament(match.tournamentId, match.winnerId);
    return;
  }

  // Get next match
  const nextMatch = await db.query.matches.findFirst({
    where: eq(matches.id, match.nextMatchId),
  });

  if (!nextMatch) return;

  // Determine which slot the winner goes to based on position parity
  const isTopHalf = match.position % 2 === 1;

  if (isTopHalf) {
    await db
      .update(matches)
      .set({ player1Id: match.winnerId, updatedAt: new Date() })
      .where(eq(matches.id, nextMatch.id));
  } else {
    await db
      .update(matches)
      .set({ player2Id: match.winnerId, updatedAt: new Date() })
      .where(eq(matches.id, nextMatch.id));
  }

  // Check if next match is ready to start
  await checkMatchReadiness(nextMatch.id);

  // Handle double elimination - loser goes to losers bracket
  if (
    tournament.format === "double_elimination" &&
    match.bracketType === "winners"
  ) {
    await advanceLoserToLosersBracket(match);
  }
}

/**
 * Check if match has both players - match remains scheduled until manually started
 */
async function checkMatchReadiness(matchId: string): Promise<void> {
  // Match remains in "scheduled" status until manually started via startMatch()
  // This function is kept for future extensibility (e.g., notifications when match is ready)
}

/**
 * Advance loser to losers bracket (for double elimination)
 */
async function advanceLoserToLosersBracket(match: Match): Promise<void> {
  // This is a simplified implementation
  // Full implementation would need proper losers bracket linking
  const loserId =
    match.player1Id === match.winnerId ? match.player2Id : match.player1Id;

  if (!loserId) return;

  // Find appropriate losers bracket match
  // This would need more complex logic based on bracket structure
  // For now, we'll skip the detailed implementation
}

/**
 * Check if tournament is complete
 */
export async function checkTournamentCompletion(
  tournamentId: string,
): Promise<boolean> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) return false;

  const allMatches = await getTournamentMatches(tournamentId);
  const completedMatches = allMatches.filter((m) => m.status === "completed");

  // For single elimination, check if final is complete
  if (tournament.format === "single_elimination") {
    const finalMatch = allMatches.find(
      (m) => !m.nextMatchId && m.bracketType === "winners",
    );
    return finalMatch?.status === "completed";
  }

  // For double elimination, check if grand final is complete
  if (tournament.format === "double_elimination") {
    const grandFinal = allMatches.find((m) => m.bracketType === "grand_final");
    return grandFinal?.status === "completed";
  }

  // For round robin, all matches must be complete
  if (tournament.format === "round_robin") {
    return completedMatches.length === allMatches.length;
  }

  return false;
}

/**
 * Get match statistics for a tournament
 */
export async function getMatchStats(tournamentId: string): Promise<{
  total: number;
  completed: number;
  inProgress: number;
  scheduled: number;
}> {
  const allMatches = await getTournamentMatches(tournamentId);

  return {
    total: allMatches.length,
    completed: allMatches.filter((m) => m.status === "completed").length,
    inProgress: allMatches.filter(
      (m) => m.status === "in_progress" || m.status === "pending_confirmation",
    ).length,
    scheduled: allMatches.filter((m) => m.status === "scheduled").length,
  };
}

/**
 * Start a match (change status from scheduled to in_progress)
 */
export async function startMatch(
  matchId: string,
): Promise<{ success: boolean; error?: string; match?: Match }> {
  try {
    const updatedMatch = await db
      .update(matches)
      .set({
        status: "in_progress",
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(matches.id, matchId))
      .returning();

    if (!updatedMatch[0]) {
      return { success: false, error: "Не удалось обновить матч" };
    }

    return { success: true, match: updatedMatch[0] };
  } catch (error) {
    return { success: false, error: JSON.stringify(error) };
  }
}
