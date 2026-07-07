import { and, eq, inArray, isNull, ne, or, asc, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import type { Executor } from '@/db/db.js';
import {
  matches,
  matchCorrections,
  tournaments,
  users,
  tables,
  tournamentTables,
  type ITournamentFormat,
} from '@/db/schema.js';
import type { Match, MatchWithPlayers } from '@/bot/@types/match.js';

/** Visitor invoked for each downstream match that holds a player advanced from a corrected match. */
type DownstreamVisitor = (
  match: Match,
  slot: 'player1' | 'player2',
  viaPlayerId: UUID,
) => void | Promise<void>;

import { completeTournament, getTournament } from './tournamentService.js';
import { notifyMatchStart } from './notificationService.js';
import type { BracketMatch } from './bracketGenerator.js';
import { getNextPowerOfTwo } from './bracketGenerator.js';
import {
  getRandomTargetPool,
  placeIntoRandomFreeSlot,
} from './randomBracketAdvancement.js';
import { errorMessage } from '@/utils/errors.js';

/** Bracket dimensions the DE random-advancement pool map needs at runtime. */
function deBracketDims(tournament: {
  mergeRound: number;
  confirmedParticipants: number | null;
  maxParticipants: number;
}): { mergeRound: number; bracketSize: number } {
  return {
    mergeRound: tournament.mergeRound,
    bracketSize: getNextPowerOfTwo(
      tournament.confirmedParticipants ?? tournament.maxParticipants,
    ),
  };
}

/**
 * Create matches in database from generated bracket
 */
export async function createMatches(
  tournamentId: UUID,
  bracket: BracketMatch[],
  executor: Executor = db,
): Promise<void> {
  if (bracket.length === 0) return;

  const now = new Date();
  const values = bracket.map((match) => {
    const isWalkover = match.isCompletedWalkover === true;
    return {
      tournamentId,
      round: match.round,
      position: match.position,
      player1Id: match.player1Id,
      player2Id: match.player2Id,
      player1IsWalkover: match.player1IsWalkover ?? false,
      player2IsWalkover: match.player2IsWalkover ?? false,
      bracketType: match.bracketType,
      phase: match.phase ?? 'playoff',
      groupIndex: match.groupIndex ?? null,
      nextMatchPosition: match.nextMatchPosition ?? null,
      losersNextMatchPosition: match.losersNextMatchPosition ?? null,
      losersNextMatchSlot: match.losersNextMatchSlot ?? null,
      status: isWalkover ? ('completed' as const) : ('scheduled' as const),
      winnerId: isWalkover ? (match.walkoverWinnerId ?? null) : null,
      isTechnicalResult: isWalkover,
      technicalReason: isWalkover ? 'walkover' : null,
      completedAt: isWalkover ? now : null,
    };
  });

  const inserted = await executor
    .insert(matches)
    .values(values)
    .returning({ id: matches.id, position: matches.position });

  // `position` is globally unique within a bracket (bracketGenerator allocates
  // it from a single monotonic counter, and `nextMatchId` references it), so a
  // position → id map resolves the routing wiring below unambiguously.
  const idByPosition = new Map(inserted.map((m) => [m.position, m.id]));

  for (const match of bracket) {
    if (match.nextMatchId === undefined) continue;
    const currentId = idByPosition.get(match.position);
    const nextId = idByPosition.get(match.nextMatchId);
    if (currentId && nextId) {
      await executor
        .update(matches)
        .set({ nextMatchId: nextId })
        .where(eq(matches.id, currentId));
    }
  }
}


// ── Shared MatchWithPlayers read model ───────────────────────────────────────
// Reusable aliases + column map + row mapper so every "match with joined player
// and table info" query (getMatch, getTournamentMatches, the player-scoped
// lookups) shares one definition. Aliases are immutable table references, safe
// to reuse across queries.
const p1Alias = alias(users, 'p1');
const p2Alias = alias(users, 'p2');
const winnerAlias = alias(users, 'winner');
const matchTableAlias = alias(tables, 'match_table');

const matchWithPlayersColumns = {
  match: matches,
  player1Username: p1Alias.username,
  player1Name: p1Alias.name,
  player1Surname: p1Alias.surname,
  player1TelegramId: p1Alias.telegram_id,
  player2Username: p2Alias.username,
  player2Name: p2Alias.name,
  player2Surname: p2Alias.surname,
  player2TelegramId: p2Alias.telegram_id,
  winnerUsername: winnerAlias.username,
  winnerName: winnerAlias.name,
  winnerSurname: winnerAlias.surname,
  winnerTelegramId: winnerAlias.telegram_id,
  tableName: matchTableAlias.name,
} as const;

/**
 * Base select for a match joined with player and table info. Callers add
 * `.where` / `.orderBy` / `.limit` (and may chain further joins — the explicit
 * column list keeps the row shape stable regardless of extra joins).
 */
function selectMatchesWithPlayers() {
  return db
    .select(matchWithPlayersColumns)
    .from(matches)
    .leftJoin(p1Alias, eq(matches.player1Id, p1Alias.id))
    .leftJoin(p2Alias, eq(matches.player2Id, p2Alias.id))
    .leftJoin(winnerAlias, eq(matches.winnerId, winnerAlias.id))
    .leftJoin(matchTableAlias, eq(matches.tableId, matchTableAlias.id));
}

type MatchWithPlayersRow = Awaited<
  ReturnType<typeof selectMatchesWithPlayers>
>[number];

function mapMatchRow(r: MatchWithPlayersRow): MatchWithPlayers {
  return {
    ...r.match,
    player1Username: r.player1Username,
    player1Name: r.player1Name,
    player1Surname: r.player1Surname,
    player1TelegramId: r.player1TelegramId,
    player2Username: r.player2Username,
    player2Name: r.player2Name,
    player2Surname: r.player2Surname,
    player2TelegramId: r.player2TelegramId,
    winnerUsername: r.winnerUsername,
    winnerName: r.winnerName,
    winnerSurname: r.winnerSurname,
    winnerTelegramId: r.winnerTelegramId,
    tableName: r.tableName,
  };
}

/**
 * Get match by ID with player information and table name
 */
export async function getMatch(
  matchId: UUID,
): Promise<MatchWithPlayers | null> {
  const rows = await selectMatchesWithPlayers()
    .where(eq(matches.id, matchId))
    .limit(1);

  return rows[0] ? mapMatchRow(rows[0]) : null;
}

/**
 * Get current active match for a player in a tournament
 */
export async function getPlayerCurrentMatch(
  tournamentId: UUID,
  userId: UUID,
): Promise<MatchWithPlayers | null> {
  const rows = await selectMatchesWithPlayers()
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

  return rows[0] ? mapMatchRow(rows[0]) : null;
}

/**
 * Get all active matches for a player across all tournaments
 */
export async function getPlayerActiveMatches(
  userId: UUID,
): Promise<MatchWithPlayers[]> {
  const rows = await selectMatchesWithPlayers()
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

  return rows.map(mapMatchRow);
}

/**
 * Get a player's completed matches across all tournaments, newest first.
 * История матчей игрока для профиля (`/api/app/me/matches`).
 */
export async function getPlayerMatchHistory(
  userId: UUID,
  options: { limit?: number } = {},
): Promise<MatchWithPlayers[]> {
  const { limit = 20 } = options;

  const rows = await selectMatchesWithPlayers()
    .where(
      and(
        eq(matches.status, 'completed'),
        or(eq(matches.player1Id, userId), eq(matches.player2Id, userId)),
      ),
    )
    .orderBy(desc(matches.completedAt))
    .limit(limit);

  return rows.map(mapMatchRow);
}

/**
 * Get all matches for a tournament with table names
 */
export async function getTournamentMatches(
  tournamentId: UUID,
): Promise<MatchWithPlayers[]> {
  const rows = await selectMatchesWithPlayers()
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(asc(matches.round), asc(matches.position));

  return rows.map(mapMatchRow);
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
 * Admin override: set / change / clear a match's table. Bypasses the
 * scheduled+empty gate used by assignTableAndStart and does not touch
 * status, startedAt, or trigger notifications. If another in-progress
 * match currently holds the requested table, it is freed in the same
 * transaction so two matches can't end up sharing a tableId.
 */
export async function setMatchTable(
  matchId: UUID,
  tableId: UUID | null,
): Promise<{ success: true } | { success: false; error: string }> {
  const [match] = await db
    .select({ tournamentId: matches.tournamentId })
    .from(matches)
    .where(eq(matches.id, matchId));

  if (!match) return { success: false, error: 'Матч не найден' };

  if (tableId !== null) {
    const [link] = await db
      .select({ tableId: tournamentTables.tableId })
      .from(tournamentTables)
      .where(
        and(
          eq(tournamentTables.tournamentId, match.tournamentId),
          eq(tournamentTables.tableId, tableId),
        ),
      );

    if (!link) {
      return { success: false, error: 'Стол не принадлежит турниру' };
    }
  }

  await db.transaction(async (tx) => {
    if (tableId !== null) {
      await tx
        .update(matches)
        .set({ tableId: null, updatedAt: new Date() })
        .where(
          and(
            eq(matches.tableId, tableId),
            eq(matches.status, 'in_progress'),
            ne(matches.id, matchId),
          ),
        );
    }

    await tx
      .update(matches)
      .set({ tableId, updatedAt: new Date() })
      .where(eq(matches.id, matchId));
  });

  return { success: true };
}

/**
 * Called when a table is freed — assigns it to the next ready match.
 *
 * No-op for per-match scheduling: there the organiser assigns each match's
 * table/time manually, so freed tables are not auto-handed to the next match.
 */
export async function onTableFreed(
  tournamentId: UUID,
  tableId: UUID,
  botApi: Api,
): Promise<void> {
  const tournament = await getTournament(tournamentId);
  if (tournament?.scheduleMode === 'per_match') return;

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
      error: `Один из игроков должен набрать ${String(winScore)} побед`,
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

  if (!match) {
    return { success: false, error: 'Матч не найден' };
  }
  if (match.status !== 'pending_confirmation') {
    return { success: false, error: 'Матч не ожидает подтверждения' };
  }
  if (match.player1Id !== confirmerId && match.player2Id !== confirmerId) {
    return { success: false, error: 'Вы не являетесь участником этого матча' };
  }
  // S2-10: подтвердить может только соперник, а не автор отчёта.
  if (match.reportedBy === confirmerId) {
    return {
      success: false,
      error: 'Нельзя подтверждать собственный отчёт',
    };
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

  if (!match?.winnerId) return;

  const tournament = await getTournament(match.tournamentId);
  if (!tournament) return;

  const loserId =
    match.player1Id === match.winnerId ? match.player2Id : match.player1Id;

  if (tournament.randomAdvancement) {
    await advanceWinnerRandom(match, loserId, tournament, botApi);
    return;
  }

  if (tournament.format === 'groups_playoff' && match.phase === 'group') {
    // Group matches don't advance a winner anywhere (qualification is by
    // standings). Free the table, and once the whole group phase is complete,
    // generate + start the playoff. Dynamic import avoids a static import cycle
    // with tournamentStartService.
    if (match.tableId && botApi) {
      await onTableFreed(match.tournamentId, match.tableId, botApi);
    }
    if (await allGroupMatchesComplete(match.tournamentId)) {
      const { maybeStartPlayoffPhase } = await import(
        './tournamentStartService.js'
      );
      await maybeStartPlayoffPhase(match.tournamentId, botApi);
    }
    return;
  }
  // groups_playoff playoff-phase matches fall through to the single-elimination
  // nextMatchId wiring below.

  if (tournament.format === 'round_robin') {
    // RR-матчи не имеют nextMatchId: завершаем турнир только когда сыграны все матчи.
    if (await checkTournamentCompletion(match.tournamentId)) {
      await completeTournament(match.tournamentId);
    }
    // Стол освобождается после каждого матча независимо от завершения турнира.
    if (match.tableId && botApi) {
      await onTableFreed(match.tournamentId, match.tableId, botApi);
    }
    return;
  }

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

/**
 * Random-mode advancement: place winner (and, for double-elim winners-bracket
 * matches, the loser too) into a random free slot of the corresponding
 * next-round pool. Used for tournaments with `randomAdvancement = true`.
 */
async function advanceWinnerRandom(
  match: Match,
  loserId: UUID | null,
  tournament: {
    format: ITournamentFormat;
    mergeRound: number;
    confirmedParticipants: number | null;
    maxParticipants: number;
  },
  botApi?: Api,
): Promise<void> {
  if (!match.winnerId) return;

  if (tournament.format === 'single_elimination') {
    await advanceWinnerRandomSingleElim(match, botApi);
    return;
  }

  const { mergeRound, bracketSize } = deBracketDims(tournament);
  const winnerPool = getRandomTargetPool(match, true, mergeRound, bracketSize);

  if (winnerPool === null) {
    await completeTournament(match.tournamentId);
    if (match.tableId && botApi) {
      await onTableFreed(match.tournamentId, match.tableId, botApi);
    }
    return;
  }

  const placedWinner = await placeIntoRandomFreeSlot(
    match.tournamentId,
    winnerPool,
    match.winnerId,
  );
  await maybeAutoResolveWalkover(
    placedWinner.matchId,
    placedWinner.slot,
    match.winnerId,
    botApi,
  );

  if (match.bracketType === 'winners' && loserId) {
    const loserPool = getRandomTargetPool(match, false, mergeRound, bracketSize);
    if (loserPool) {
      const placedLoser = await placeIntoRandomFreeSlot(
        match.tournamentId,
        loserPool,
        loserId,
      );
      await maybeAutoResolveWalkover(
        placedLoser.matchId,
        placedLoser.slot,
        loserId,
        botApi,
      );
    }
  }

  if (match.tableId && botApi) {
    await onTableFreed(match.tournamentId, match.tableId, botApi);
  }
}

/**
 * Random-mode advancement for single elimination: place the winner into a
 * random free slot of the next round (all matches are `winners`). The loser is
 * simply eliminated. When the next round has no matches, the tournament is over.
 */
async function advanceWinnerRandomSingleElim(
  match: Match,
  botApi?: Api,
): Promise<void> {
  if (!match.winnerId) return;

  const nextRound = match.round + 1;
  const nextRoundMatches = await db.query.matches.findMany({
    where: and(
      eq(matches.tournamentId, match.tournamentId),
      eq(matches.bracketType, 'winners'),
      eq(matches.round, nextRound),
    ),
  });

  if (nextRoundMatches.length === 0) {
    await completeTournament(match.tournamentId);
    if (match.tableId && botApi) {
      await onTableFreed(match.tournamentId, match.tableId, botApi);
    }
    return;
  }

  const placed = await placeIntoRandomFreeSlot(
    match.tournamentId,
    { bracketType: 'winners', round: nextRound },
    match.winnerId,
  );
  await maybeAutoResolveWalkover(
    placed.matchId,
    placed.slot,
    match.winnerId,
    botApi,
  );

  if (match.tableId && botApi) {
    await onTableFreed(match.tournamentId, match.tableId, botApi);
  }
}

/**
 * Where the loser of a winners-bracket match drops into the losers bracket.
 * Reads the routing the generator stored on the row (`losersNextMatchPosition` +
 * `losersNextMatchSlot`), so it works for any bracket size / merge round. Returns
 * null when the loser is eliminated (no drop stored). Single source of truth
 * shared by advanceLoserToLosersBracket (forward) and the correction rollback
 * (reverse), so the two can never drift.
 */
export function loserTarget(
  match: Match,
): { position: number; slot: 'player1Id' | 'player2Id' } | null {
  if (match.bracketType !== 'winners') return null;
  if (match.losersNextMatchPosition == null) return null;

  const slot = match.losersNextMatchSlot;
  if (slot === 'player1' || slot === 'player2') {
    return {
      position: match.losersNextMatchPosition,
      slot: slot === 'player1' ? 'player1Id' : 'player2Id',
    };
  }

  // Backward-compat fallback for rows created before `losersNextMatchSlot`
  // existed (the historical fixed 16-slot, merge-round-2 layout): round 1 →
  // odd position to player1 / even to player2; round 2 → player2.
  return {
    position: match.losersNextMatchPosition,
    slot:
      match.round === 1
        ? match.position % 2 === 1
          ? 'player1Id'
          : 'player2Id'
        : 'player2Id',
  };
}

async function advanceLoserToLosersBracket(
  match: Match,
  loserId: UUID,
  botApi?: Api,
): Promise<void> {
  const target = loserTarget(match);
  if (!target) return;

  const losersMatch = await db.query.matches.findFirst({
    where: and(
      eq(matches.tournamentId, match.tournamentId),
      eq(matches.position, target.position),
    ),
  });

  if (!losersMatch) {
    console.error(
      `Losers match not found at position ${String(target.position)} for tournament ${match.tournamentId}`,
    );
    return;
  }

  await db
    .update(matches)
    .set({ [target.slot]: loserId, updatedAt: new Date() })
    .where(eq(matches.id, losersMatch.id));

  const filledSlot: 'player1' | 'player2' =
    target.slot === 'player1Id' ? 'player1' : 'player2';
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
 * True once every group-phase match of a groups_playoff tournament is completed.
 * Used to trigger the group→playoff transition.
 */
export async function allGroupMatchesComplete(
  tournamentId: UUID,
): Promise<boolean> {
  const groupMatches = await db.query.matches.findMany({
    where: and(
      eq(matches.tournamentId, tournamentId),
      eq(matches.phase, 'group'),
    ),
  });
  if (groupMatches.length === 0) return false;
  return groupMatches.every((m) => m.status === 'completed');
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

  if (tournament.format === 'groups_playoff') {
    // Not complete until the playoff exists and its final (highest-round playoff
    // match) is done. Before the playoff is generated there are only group rows,
    // so this returns false and the tournament does not complete at end of groups.
    const playoff = allMatches.filter((m) => m.phase === 'playoff');
    if (playoff.length === 0) return false;
    const maxRound = playoff.reduce((max, m) => Math.max(max, m.round), 0);
    return playoff.find((m) => m.round === maxRound)?.status === 'completed';
  }

  if (tournament.format === 'single_elimination') {
    // The final is the single highest-round winners match. Detecting it by the
    // absence of `nextMatchId` breaks under random advancement (pointers are
    // stripped from every match), so key off the max round instead.
    const winnersMatches = allMatches.filter(
      (m) => m.bracketType === 'winners',
    );
    const maxRound = winnersMatches.reduce((max, m) => Math.max(max, m.round), 0);
    const finalMatch = winnersMatches.find((m) => m.round === maxRound);
    return finalMatch?.status === 'completed';
  }

  if (tournament.format === 'double_elimination') {
    // The terminal match is the single highest-round winners match (the merge
    // playoff final / grand final). Keying off max round is robust to any bracket
    // size, merge round, and random advancement (where pointers are stripped).
    const winnersMatches = allMatches.filter(
      (m) => m.bracketType === 'winners',
    );
    const maxRound = winnersMatches.reduce((max, m) => Math.max(max, m.round), 0);
    const finalMatch = winnersMatches.find((m) => m.round === maxRound);
    return finalMatch?.status === 'completed';
  }

  return completedMatches.length === allMatches.length;
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
    const match = await getMatch(matchId);
    if (!match) return { success: false, error: 'Матч не найден' };
    if (match.status !== 'scheduled') {
      return {
        success: false,
        error: 'Матч можно начать только из статуса «Запланирован»',
      };
    }

    const updatedMatch = await db
      .update(matches)
      .set({
        status: 'in_progress',
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(matches.id, matchId), eq(matches.status, 'scheduled')))
      .returning();

    if (!updatedMatch[0]) {
      return { success: false, error: 'Статус матча изменился, обновите страницу' };
    }

    return { success: true, match: updatedMatch[0] };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Set or clear a match's scheduled date/time (per-match scheduling). Does not
 * touch the match status — scheduling is independent of starting the match.
 * Pass `null` to clear the schedule.
 */
export async function setMatchSchedule(
  matchId: UUID,
  scheduledAt: Date | null,
): Promise<{ success: boolean; error?: string; match?: Match }> {
  try {
    const updatedMatch = await db
      .update(matches)
      .set({ scheduledAt, updatedAt: new Date() })
      .where(eq(matches.id, matchId))
      .returning();

    if (!updatedMatch[0]) {
      return { success: false, error: 'Матч не найден' };
    }

    return { success: true, match: updatedMatch[0] };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

// ── Result correction (admin) ────────────────────────────────────────────────

/**
 * Validate a corrected score using the same rule as reportResult: exactly one
 * player must reach winScore, and not both. Returns an error string or null.
 */
export function validateCorrectionScores(
  player1Score: number,
  player2Score: number,
  winScore: number,
): string | null {
  if (player1Score !== winScore && player2Score !== winScore) {
    return `Один из игроков должен набрать ${String(winScore)} побед`;
  }
  if (player1Score === winScore && player2Score === winScore) {
    return 'Оба игрока не могут выиграть';
  }
  return null;
}

/** Find which slot of a random-format pool currently holds the given player. */
async function findPlayerSlotInPool(
  exec: Executor,
  tournamentId: UUID,
  pool: { bracketType: 'winners' | 'losers'; round: number },
  playerId: UUID,
): Promise<{ match: Match; slot: 'player1' | 'player2' } | null> {
  const candidates = await exec.query.matches.findMany({
    where: and(
      eq(matches.tournamentId, tournamentId),
      eq(matches.bracketType, pool.bracketType),
      eq(matches.round, pool.round),
    ),
  });
  for (const m of candidates) {
    if (m.player1Id === playerId) return { match: m, slot: 'player1' };
    if (m.player2Id === playerId) return { match: m, slot: 'player2' };
  }
  return null;
}

/**
 * Walk the downstream closure of a completed match: for every match that holds
 * a player advanced from `match` (its winner via nextMatchId / random pool, and
 * — in double-elimination — its loser via the losers bracket), recurse first
 * (so the row is still intact when read), then invoke `visit`. Read-only on its
 * own; the visitor decides what to do. Shared by previewCorrection (count) and
 * correctMatchResult (reset), so the two can never diverge.
 */
async function walkDownstream(
  exec: Executor,
  match: Match,
  tournament: {
    format: ITournamentFormat;
    randomAdvancement: boolean;
    mergeRound: number;
    confirmedParticipants: number | null;
    maxParticipants: number;
  },
  visit: DownstreamVisitor,
): Promise<void> {
  if (!match.winnerId) return;

  const loserId =
    match.player1Id === match.winnerId ? match.player2Id : match.player1Id;

  const { mergeRound, bracketSize } = deBracketDims(tournament);

  const placements: {
    match: Match;
    slot: 'player1' | 'player2';
    player: UUID;
  }[] = [];

  if (tournament.randomAdvancement) {
    // Single elimination uses a plain next-round pool; double elimination uses
    // the merge-round-aware getRandomTargetPool.
    const winnerPool =
      tournament.format === 'single_elimination'
        ? { bracketType: 'winners' as const, round: match.round + 1 }
        : getRandomTargetPool(match, true, mergeRound, bracketSize);
    if (winnerPool) {
      const found = await findPlayerSlotInPool(
        exec,
        match.tournamentId,
        winnerPool,
        match.winnerId,
      );
      if (found) {
        placements.push({
          match: found.match,
          slot: found.slot,
          player: match.winnerId,
        });
      }
    }
    if (
      tournament.format === 'double_elimination' &&
      match.bracketType === 'winners' &&
      loserId
    ) {
      const loserPool = getRandomTargetPool(match, false, mergeRound, bracketSize);
      if (loserPool) {
        const found = await findPlayerSlotInPool(
          exec,
          match.tournamentId,
          loserPool,
          loserId,
        );
        if (found) {
          placements.push({
            match: found.match,
            slot: found.slot,
            player: loserId,
          });
        }
      }
    }
  } else {
    if (match.nextMatchId) {
      const slot: 'player1' | 'player2' =
        match.nextMatchPosition === 'player1' ||
        match.nextMatchPosition === 'player2'
          ? match.nextMatchPosition
          : match.position % 2 === 1
            ? 'player1'
            : 'player2';
      const next = await exec.query.matches.findFirst({
        where: eq(matches.id, match.nextMatchId),
      });
      const nextSlotId =
        slot === 'player1' ? next?.player1Id : next?.player2Id;
      if (next && nextSlotId === match.winnerId) {
        placements.push({ match: next, slot, player: match.winnerId });
      }
    }

    if (
      tournament.format === 'double_elimination' &&
      match.bracketType === 'winners' &&
      loserId
    ) {
      const target = loserTarget(match);
      if (target) {
        const losersMatch = await exec.query.matches.findFirst({
          where: and(
            eq(matches.tournamentId, match.tournamentId),
            eq(matches.position, target.position),
          ),
        });
        const slot: 'player1' | 'player2' =
          target.slot === 'player1Id' ? 'player1' : 'player2';
        const slotId =
          slot === 'player1' ? losersMatch?.player1Id : losersMatch?.player2Id;
        if (losersMatch && slotId === loserId) {
          placements.push({ match: losersMatch, slot, player: loserId });
        }
      }
    }
  }

  for (const p of placements) {
    if (p.match.status === 'completed' && p.match.winnerId) {
      await walkDownstream(exec, p.match, tournament, visit);
    }
    await visit(p.match, p.slot, p.player);
  }
}

/**
 * Reset a downstream match whose participant changed: clear only the slot fed
 * from upstream (the sibling-fed player is preserved), wipe the result, and put
 * it back to `scheduled` for a replay. Structural walkover flags are left intact
 * so re-advance can re-resolve byes.
 */
async function resetDownstream(
  exec: Executor,
  match: Match,
  slot: 'player1' | 'player2',
  affected: UUID[],
): Promise<void> {
  const slotCol = slot === 'player1' ? 'player1Id' : 'player2Id';
  await exec
    .update(matches)
    .set({
      [slotCol]: null,
      status: 'scheduled',
      winnerId: null,
      player1Score: null,
      player2Score: null,
      reportedBy: null,
      confirmedBy: null,
      isTechnicalResult: false,
      technicalReason: null,
      startedAt: null,
      completedAt: null,
      tableId: null,
      updatedAt: new Date(),
    })
    .where(eq(matches.id, match.id));
  affected.push(match.id);
}

export interface CorrectionPreview {
  valid: boolean;
  error?: string;
  winnerChanged: boolean;
  affectedCount: number;
  willReshuffle: boolean;
  tournamentWillReopen: boolean;
}

/**
 * Read-only dry run: validate a proposed correction and count how many
 * downstream matches would be reset, without writing anything.
 */
/**
 * Whether a corrected match feeds a bracket cascade (winner advances via
 * nextMatchId / loser drop). Round-robin and groups_playoff group-phase matches
 * do not — their corrections are plain score edits, no downstream rollback.
 */
function matchHasBracketCascade(
  format: ITournamentFormat,
  match: { phase: string },
): boolean {
  if (format === 'round_robin') return false;
  if (format === 'groups_playoff' && match.phase === 'group') return false;
  return true;
}

/**
 * Group-phase results lock once the playoff has been generated: recomputing
 * qualifiers mid-playoff would invalidate already-played bracket matches. Returns
 * an error string if the correction must be blocked, else null.
 */
async function groupResultLockError(
  format: ITournamentFormat,
  match: { tournamentId: UUID; phase: string },
): Promise<string | null> {
  if (format !== 'groups_playoff' || match.phase !== 'group') return null;
  const playoffExists = await db.query.matches.findFirst({
    where: and(
      eq(matches.tournamentId, match.tournamentId),
      eq(matches.phase, 'playoff'),
    ),
  });
  return playoffExists
    ? 'Групповой этап завершён, результаты группы изменить нельзя'
    : null;
}

export async function previewCorrection(
  matchId: UUID,
  newPlayer1Score: number,
  newPlayer2Score: number,
): Promise<CorrectionPreview> {
  const empty = {
    winnerChanged: false,
    affectedCount: 0,
    willReshuffle: false,
    tournamentWillReopen: false,
  };

  const match = await getMatch(matchId);
  if (!match) return { valid: false, error: 'Матч не найден', ...empty };
  if (match.status !== 'completed') {
    return {
      valid: false,
      error: 'Корректировать можно только завершённый матч',
      ...empty,
    };
  }
  if (!match.player1Id || !match.player2Id) {
    return { valid: false, error: 'У матча нет обоих игроков', ...empty };
  }

  const tournament = await getTournament(match.tournamentId);
  if (!tournament) return { valid: false, error: 'Турнир не найден', ...empty };

  const lockError = await groupResultLockError(tournament.format, match);
  if (lockError) return { valid: false, error: lockError, ...empty };

  const scoreError = validateCorrectionScores(
    newPlayer1Score,
    newPlayer2Score,
    tournament.winScore,
  );
  if (scoreError) return { valid: false, error: scoreError, ...empty };

  const newWinnerId =
    newPlayer1Score > newPlayer2Score ? match.player1Id : match.player2Id;
  const winnerChanged = newWinnerId !== match.winnerId;
  const hasCascade = matchHasBracketCascade(tournament.format, match);

  let affectedCount = 0;
  if (winnerChanged && hasCascade) {
    const ids = new Set<UUID>();
    await walkDownstream(db, match, tournament, (m) => {
      ids.add(m.id);
    });
    affectedCount = ids.size;
  }

  return {
    valid: true,
    winnerChanged,
    affectedCount,
    willReshuffle: tournament.randomAdvancement && winnerChanged,
    tournamentWillReopen:
      winnerChanged && tournament.status === 'completed' && hasCascade,
  };
}

/**
 * Correct the score of a completed match. If the winner is unchanged this is a
 * plain score edit. If the winner flips, every downstream match the old winner
 * (and, in double-elimination, the old loser) advanced into is rolled back to
 * `scheduled` for replay, and the new winner is re-advanced.
 *
 * The destructive rollback runs in a transaction; re-advancement reuses the
 * existing advanceWinner after commit (its helpers close over the module-level
 * db). A failed re-advance is recoverable via the admin /advance endpoint.
 */
export async function correctMatchResult(
  matchId: UUID,
  newPlayer1Score: number,
  newPlayer2Score: number,
  reason: string,
  correctedBy: UUID,
  botApi?: Api,
): Promise<{
  success: boolean;
  error?: string;
  affectedCount?: number;
  winnerChanged?: boolean;
  warning?: string;
}> {
  const match = await getMatch(matchId);
  if (!match) return { success: false, error: 'Матч не найден' };
  if (match.status !== 'completed') {
    return { success: false, error: 'Корректировать можно только завершённый матч' };
  }
  if (!match.player1Id || !match.player2Id) {
    return { success: false, error: 'У матча нет обоих игроков' };
  }

  const tournament = await getTournament(match.tournamentId);
  if (!tournament) return { success: false, error: 'Турнир не найден' };

  const lockError = await groupResultLockError(tournament.format, match);
  if (lockError) return { success: false, error: lockError };

  const scoreError = validateCorrectionScores(
    newPlayer1Score,
    newPlayer2Score,
    tournament.winScore,
  );
  if (scoreError) return { success: false, error: scoreError };

  const newWinnerId =
    newPlayer1Score > newPlayer2Score ? match.player1Id : match.player2Id;
  const winnerChanged = newWinnerId !== match.winnerId;
  const needsRollback =
    winnerChanged && matchHasBracketCascade(tournament.format, match);
  const affected: UUID[] = [];

  await db.transaction(async (tx) => {
    // Serialize concurrent corrections of the same match.
    await tx
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.id, matchId))
      .for('update');

    if (needsRollback) {
      await walkDownstream(tx, match, tournament, (m, slot) =>
        resetDownstream(tx, m, slot, affected),
      );
      if (tournament.status === 'completed') {
        await tx
          .update(tournaments)
          .set({ status: 'in_progress', updatedAt: new Date() })
          .where(eq(tournaments.id, tournament.id));
      }
    }

    await tx
      .update(matches)
      .set({
        player1Score: newPlayer1Score,
        player2Score: newPlayer2Score,
        winnerId: newWinnerId,
        isCorrected: true,
        correctionReason: reason,
        isTechnicalResult: false,
        technicalReason: null,
        updatedAt: new Date(),
      })
      .where(eq(matches.id, matchId));

    await tx.insert(matchCorrections).values({
      matchId,
      tournamentId: match.tournamentId,
      correctedBy,
      reason,
      previousPlayer1Score: match.player1Score,
      previousPlayer2Score: match.player2Score,
      previousWinnerId: match.winnerId,
      newPlayer1Score,
      newPlayer2Score,
      newWinnerId,
      affectedMatchIds: affected.length ? affected : null,
    });
  });

  if (needsRollback) {
    try {
      await advanceWinner(matchId, botApi);
    } catch (error) {
      console.error(
        `Failed to re-advance after correcting match ${matchId}:`,
        error,
      );
      return {
        success: true,
        affectedCount: affected.length,
        winnerChanged,
        warning:
          'Результат исправлен, но не удалось продвинуть победителя. Используйте «Пересинхронизировать».',
      };
    }
  }

  return { success: true, affectedCount: affected.length, winnerChanged };
}

/**
 * Admin recovery: re-run advancement for a completed match. Idempotent — used
 * to re-sync the bracket if a correction's post-commit re-advance failed.
 */
export async function resyncAdvancement(
  matchId: UUID,
  botApi?: Api,
): Promise<{ success: boolean; error?: string }> {
  const match = await getMatch(matchId);
  if (!match) return { success: false, error: 'Матч не найден' };
  if (match.status !== 'completed' || !match.winnerId) {
    return { success: false, error: 'Матч не завершён' };
  }
  await advanceWinner(matchId, botApi);
  return { success: true };
}
