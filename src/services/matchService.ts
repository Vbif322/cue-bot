import { and, eq, inArray, isNull, or, asc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { matches, tournaments, users, tables } from '@/db/schema.js';
import type { Match, MatchWithPlayers } from '@/bot/@types/match.js';

import { completeTournament, getTournament } from './tournamentService.js';
import { notifyMatchStart } from './notificationService.js';
import type { BracketMatch } from './bracketGenerator.js';

/**
 * Create matches in database from generated bracket
 */
export async function createMatches(
  tournamentId: UUID,
  bracket: BracketMatch[],
): Promise<void> {
  const createdMatches: { position: number; id: UUID }[] = [];

  for (const match of bracket) {
    const isWalkover = match.isCompletedWalkover === true;
    const [created] = await db
      .insert(matches)
      .values({
        tournamentId,
        round: match.round,
        position: match.position,
        player1Id: match.player1Id,
        player2Id: match.player2Id,
        player1IsWalkover: match.player1IsWalkover ?? false,
        player2IsWalkover: match.player2IsWalkover ?? false,
        bracketType: match.bracketType,
        nextMatchPosition: match.nextMatchPosition ?? null,
        losersNextMatchPosition: match.losersNextMatchPosition ?? null,
        status: isWalkover ? 'completed' : 'scheduled',
        winnerId: isWalkover ? match.walkoverWinnerId ?? null : null,
        isTechnicalResult: isWalkover,
        technicalReason: isWalkover ? 'walkover' : null,
        completedAt: isWalkover ? new Date() : null,
      })
      .returning({ id: matches.id, position: matches.position });

    if (created) {
      createdMatches.push({ position: match.position, id: created.id });
    }
  }

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

function determineInitialStatus(
  _match: BracketMatch,
): (typeof matches.$inferSelect)['status'] {
  return 'scheduled';
}

/**
 * Get match by ID with player information and table name
 */
export async function getMatch(
  matchId: UUID,
): Promise<MatchWithPlayers | null> {
  const p1 = alias(users, 'p1');
  const p2 = alias(users, 'p2');
  const winner = alias(users, 'winner');
  const matchTable = alias(tables, 'match_table');

  const rows = await db
    .select({
      match: matches,
      player1Username: p1.username,
      player1Name: p1.name,
      player1TelegramId: p1.telegram_id,
      player2Username: p2.username,
      player2Name: p2.name,
      player2TelegramId: p2.telegram_id,
      winnerUsername: winner.username,
      winnerName: winner.name,
      winnerTelegramId: winner.telegram_id,
      tableName: matchTable.name,
    })
    .from(matches)
    .leftJoin(p1, eq(matches.player1Id, p1.id))
    .leftJoin(p2, eq(matches.player2Id, p2.id))
    .leftJoin(winner, eq(matches.winnerId, winner.id))
    .leftJoin(matchTable, eq(matches.tableId, matchTable.id))
    .where(eq(matches.id, matchId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row.match,
    player1Username: row.player1Username,
    player1Name: row.player1Name,
    player1TelegramId: row.player1TelegramId,
    player2Username: row.player2Username,
    player2Name: row.player2Name,
    player2TelegramId: row.player2TelegramId,
    winnerUsername: row.winnerUsername,
    winnerName: row.winnerName,
    winnerTelegramId: row.winnerTelegramId,
    tableName: row.tableName,
  };
}

/**
 * Get current active match for a player in a tournament
 */
export async function getPlayerCurrentMatch(
  tournamentId: UUID,
  userId: UUID,
): Promise<MatchWithPlayers | null> {
  const result = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, tournamentId),
        or(eq(matches.player1Id, userId), eq(matches.player2Id, userId)),
        inArray(matches.status, [
          'scheduled',
          'in_progress',
          'pending_confirmation',
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
  userId: UUID,
): Promise<MatchWithPlayers[]> {
  const result = await db
    .select()
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .where(
      and(
        eq(tournaments.status, 'in_progress'),
        or(eq(matches.player1Id, userId), eq(matches.player2Id, userId)),
        inArray(matches.status, [
          'scheduled',
          'in_progress',
          'pending_confirmation',
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
 * Get all matches for a tournament with table names
 */
export async function getTournamentMatches(
  tournamentId: UUID,
): Promise<MatchWithPlayers[]> {
  const p1 = alias(users, 'p1');
  const p2 = alias(users, 'p2');
  const winner = alias(users, 'winner');
  const matchTable = alias(tables, 'match_table');

  const rows = await db
    .select({
      match: matches,
      player1Username: p1.username,
      player1Name: p1.name,
      player2Username: p2.username,
      player2Name: p2.name,
      winnerUsername: winner.username,
      tableName: matchTable.name,
    })
    .from(matches)
    .leftJoin(p1, eq(matches.player1Id, p1.id))
    .leftJoin(p2, eq(matches.player2Id, p2.id))
    .leftJoin(winner, eq(matches.winnerId, winner.id))
    .leftJoin(matchTable, eq(matches.tableId, matchTable.id))
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(asc(matches.round), asc(matches.position));

  return rows.map((r) => ({
    ...r.match,
    player1Username: r.player1Username,
    player1Name: r.player1Name,
    player2Username: r.player2Username,
    player2Name: r.player2Name,
    winnerUsername: r.winnerUsername,
    tableName: r.tableName,
  }));
}

/**
 * Get matches for a specific round
 */
export async function getRoundMatches(
  tournamentId: UUID,
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
 * Get the next scheduled match with both players assigned and no table yet
 */
export async function getNextReadyMatch(
  tournamentId: UUID,
): Promise<Match | null> {
  const result = await db.query.matches.findMany({
    where: and(
      eq(matches.tournamentId, tournamentId),
      eq(matches.status, 'scheduled'),
      isNull(matches.tableId),
    ),
    orderBy: [asc(matches.round), asc(matches.position)],
  });

  // Return first match where both players are assigned
  return result.find((m) => m.player1Id && m.player2Id) ?? null;
}

/**
 * Atomically assign a table to a match and start it.
 * Returns true if assignment succeeded (false = race condition).
 */
export async function assignTableAndStart(
  matchId: UUID,
  tableId: UUID,
  botApi?: Api,
): Promise<boolean> {
  const updated = await db
    .update(matches)
    .set({
      tableId,
      status: 'in_progress',
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(matches.id, matchId),
        eq(matches.status, 'scheduled'),
        isNull(matches.tableId),
      ),
    )
    .returning({ id: matches.id });

  if (!updated.length) return false;

  if (botApi) {
    try {
      const matchWithPlayers = await getMatch(matchId);
      const tournament = matchWithPlayers
        ? await getTournament(matchWithPlayers.tournamentId)
        : null;
      if (matchWithPlayers && tournament) {
        await notifyMatchStart(botApi, matchWithPlayers, tournament.name, '');
      }
    } catch (err) {
      console.error(`Failed to notify match start for ${matchId}:`, err);
    }
  }

  return true;
}

/**
 * Called when a table is freed — assigns it to the next ready match
 */
export async function onTableFreed(
  tournamentId: UUID,
  tableId: UUID,
  botApi: Api,
): Promise<void> {
  const next = await getNextReadyMatch(tournamentId);
  if (!next) return;
  await assignTableAndStart(next.id, tableId, botApi);
}

/**
 * Report match result
 */
export async function reportResult(
  matchId: UUID,
  reporterId: UUID,
  player1Score: number,
  player2Score: number,
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatch(matchId);

  if (!match) return { success: false, error: 'Матч не найден' };
  if (match.status === 'completed')
    return { success: false, error: 'Матч уже завершён' };
  if (match.status === 'cancelled')
    return { success: false, error: 'Матч отменён' };

  if (match.player1Id !== reporterId && match.player2Id !== reporterId) {
    return { success: false, error: 'Вы не являетесь участником этого матча' };
  }

  const tournament = await getTournament(match.tournamentId);
  if (!tournament) return { success: false, error: 'Турнир не найден' };

  const winScore = tournament.winScore;
  if (player1Score !== winScore && player2Score !== winScore) {
    return {
      success: false,
      error: `Один из игроков должен набрать ${winScore} побед`,
    };
  }
  if (player1Score === winScore && player2Score === winScore) {
    return { success: false, error: 'Оба игрока не могут выиграть' };
  }

  const winnerId =
    player1Score > player2Score ? match.player1Id : match.player2Id;

  await db
    .update(matches)
    .set({
      player1Score,
      player2Score,
      winnerId,
      reportedBy: reporterId,
      status: 'pending_confirmation',
      updatedAt: new Date(),
    })
    .where(eq(matches.id, matchId));

  return { success: true };
}

/**
 * Confirm match result
 */
export async function confirmResult(
  matchId: UUID,
  confirmerId: UUID,
  botApi?: Api,
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatch(matchId);

  if (!match) return { success: false, error: 'Матч не найден' };
  if (match.status !== 'pending_confirmation') {
    return { success: false, error: 'Матч не ожидает подтверждения' };
  }
  if (match.reportedBy === confirmerId) {
    return {
      success: false,
      error: 'Вы не можете подтвердить свой собственный результат',
    };
  }
  if (match.player1Id !== confirmerId && match.player2Id !== confirmerId) {
    return { success: false, error: 'Вы не являетесь участником этого матча' };
  }

  const updated = await db
    .update(matches)
    .set({
      status: 'completed',
      confirmedBy: confirmerId,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(matches.id, matchId), eq(matches.status, 'pending_confirmation')),
    )
    .returning();

  if (!updated.length) {
    return {
      success: false,
      error: 'Статус матча изменился. Попробуйте обновить страницу.',
    };
  }

  await advanceWinner(matchId, botApi);

  return { success: true };
}

/**
 * Dispute match result
 */
export async function disputeResult(
  matchId: UUID,
  userId: UUID,
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatch(matchId);

  if (!match) return { success: false, error: 'Матч не найден' };
  if (match.status !== 'pending_confirmation') {
    return { success: false, error: 'Матч не ожидает подтверждения' };
  }
  if (match.player1Id !== userId && match.player2Id !== userId) {
    return { success: false, error: 'Вы не являетесь участником этого матча' };
  }

  const updated = await db
    .update(matches)
    .set({
      status: 'in_progress',
      player1Score: null,
      player2Score: null,
      winnerId: null,
      reportedBy: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(matches.id, matchId), eq(matches.status, 'pending_confirmation')),
    )
    .returning();

  if (!updated.length) {
    return {
      success: false,
      error: 'Статус матча изменился. Попробуйте обновить страницу.',
    };
  }

  return { success: true };
}

/**
 * Set technical result for a match
 */
export async function setTechnicalResult(
  matchId: UUID,
  winnerId: UUID,
  reason: string,
  setById: UUID,
  botApi?: Api,
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatch(matchId);

  if (!match) return { success: false, error: 'Матч не найден' };
  if (match.status === 'completed' || match.status === 'cancelled') {
    return { success: false, error: 'Матч уже завершён или отменён' };
  }
  if (match.player1Id !== winnerId && match.player2Id !== winnerId) {
    return { success: false, error: 'Победитель должен быть участником матча' };
  }

  const tournament = await getTournament(match.tournamentId);
  if (!tournament) return { success: false, error: 'Турнир не найден' };

  const winScore = tournament.winScore;
  const player1Score = match.player1Id === winnerId ? winScore : 0;
  const player2Score = match.player2Id === winnerId ? winScore : 0;

  await db
    .update(matches)
    .set({
      player1Score,
      player2Score,
      winnerId,
      status: 'completed',
      isTechnicalResult: true,
      technicalReason: reason,
      confirmedBy: setById,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(matches.id, matchId));

  await advanceWinner(matchId, botApi);

  return { success: true };
}

/**
 * Advance winner to next match and free the table
 */
export async function advanceWinner(
  matchId: UUID,
  botApi?: Api,
): Promise<void> {
  const match = await db.query.matches.findFirst({
    where: eq(matches.id, matchId),
  });

  if (!match || !match.winnerId) return;

  const tournament = await getTournament(match.tournamentId);
  if (!tournament) return;

  const loserId =
    match.player1Id === match.winnerId ? match.player2Id : match.player1Id;

  if (!match.nextMatchId) {
    await completeTournament(match.tournamentId);
    // Free the table even at tournament end (no-op since no next match)
    if (match.tableId && botApi) {
      await onTableFreed(match.tournamentId, match.tableId, botApi);
    }
    return;
  }

  const nextMatch = await db.query.matches.findFirst({
    where: eq(matches.id, match.nextMatchId),
  });

  if (!nextMatch) return;

  const slot =
    match.nextMatchPosition ??
    (match.position % 2 === 1 ? 'player1' : 'player2');

  if (slot === 'player1') {
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

  await maybeAutoResolveWalkover(
    nextMatch.id,
    slot === 'player1' ? 'player1' : 'player2',
    match.winnerId,
    botApi,
  );

  if (
    tournament.format === 'double_elimination' &&
    match.bracketType === 'winners' &&
    loserId
  ) {
    await advanceLoserToLosersBracket(match, loserId, botApi);
  }

  // Free the table and assign to next ready match
  if (match.tableId && botApi) {
    await onTableFreed(match.tournamentId, match.tableId, botApi);
  }
}

async function advanceLoserToLosersBracket(
  match: Match,
  loserId: UUID,
  botApi?: Api,
): Promise<void> {
  if (match.round > 2 || match.bracketType !== 'winners') return;

  let targetPosition: number;
  let targetSlot: 'player1Id' | 'player2Id';

  if (match.round === 1) {
    targetPosition = 9 + Math.floor((match.position - 1) / 2);
    targetSlot = match.position % 2 === 1 ? 'player1Id' : 'player2Id';
  } else {
    targetPosition = 17 + (match.position - 13);
    targetSlot = 'player2Id';
  }

  const losersMatch = await db.query.matches.findFirst({
    where: and(
      eq(matches.tournamentId, match.tournamentId),
      eq(matches.position, targetPosition),
    ),
  });

  if (!losersMatch) {
    console.error(
      `Losers match not found at position ${targetPosition} for tournament ${match.tournamentId}`,
    );
    return;
  }

  await db
    .update(matches)
    .set({ [targetSlot]: loserId, updatedAt: new Date() })
    .where(eq(matches.id, losersMatch.id));

  const filledSlot: 'player1' | 'player2' =
    targetSlot === 'player1Id' ? 'player1' : 'player2';
  await maybeAutoResolveWalkover(losersMatch.id, filledSlot, loserId, botApi);
}

/**
 * After a real player is placed into a slot, check if the OTHER slot is
 * walkover-bound (null with playerNIsWalkover=true). If so, auto-complete
 * the match with the just-placed player as winner and recursively propagate.
 */
async function maybeAutoResolveWalkover(
  matchId: UUID,
  filledSlot: 'player1' | 'player2',
  filledPlayerId: UUID,
  botApi?: Api,
): Promise<void> {
  const target = await db.query.matches.findFirst({
    where: eq(matches.id, matchId),
  });
  if (!target) return;
  if (target.status === 'completed') return;

  const otherIsWalkover =
    filledSlot === 'player1'
      ? target.player2IsWalkover
      : target.player1IsWalkover;
  const otherPlayerId =
    filledSlot === 'player1' ? target.player2Id : target.player1Id;

  if (!otherIsWalkover || otherPlayerId !== null) return;

  await db
    .update(matches)
    .set({
      winnerId: filledPlayerId,
      status: 'completed',
      isTechnicalResult: true,
      technicalReason: 'walkover',
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(matches.id, target.id));

  await advanceWinner(target.id, botApi);
}

/**
 * Check if tournament is complete
 */
export async function checkTournamentCompletion(
  tournamentId: UUID,
): Promise<boolean> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) return false;

  const allMatches = await getTournamentMatches(tournamentId);
  const completedMatches = allMatches.filter((m) => m.status === 'completed');

  if (tournament.format === 'single_elimination') {
    const finalMatch = allMatches.find(
      (m) => !m.nextMatchId && m.bracketType === 'winners',
    );
    return finalMatch?.status === 'completed';
  }

  if (tournament.format === 'double_elimination') {
    const grandFinal = allMatches.find((m) => m.bracketType === 'grand_final');
    return grandFinal?.status === 'completed';
  }

  if (tournament.format === 'round_robin') {
    return completedMatches.length === allMatches.length;
  }

  return false;
}

/**
 * Get match statistics for a tournament
 */
export async function getMatchStats(tournamentId: UUID): Promise<{
  total: number;
  completed: number;
  inProgress: number;
  scheduled: number;
}> {
  const allMatches = await getTournamentMatches(tournamentId);

  return {
    total: allMatches.length,
    completed: allMatches.filter((m) => m.status === 'completed').length,
    inProgress: allMatches.filter(
      (m) => m.status === 'in_progress' || m.status === 'pending_confirmation',
    ).length,
    scheduled: allMatches.filter((m) => m.status === 'scheduled').length,
  };
}

/**
 * Start a match manually (change status from scheduled to in_progress)
 */
export async function startMatch(
  matchId: UUID,
): Promise<{ success: boolean; error?: string; match?: Match }> {
  try {
    const updatedMatch = await db
      .update(matches)
      .set({
        status: 'in_progress',
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(matches.id, matchId))
      .returning();

    if (!updatedMatch[0]) {
      return { success: false, error: 'Не удалось обновить матч' };
    }

    return { success: true, match: updatedMatch[0] };
  } catch (error) {
    return { success: false, error: JSON.stringify(error) };
  }
}
