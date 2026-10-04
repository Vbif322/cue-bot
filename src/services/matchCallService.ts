import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { matches, tournamentParticipants, tournaments } from '@/db/schema.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import { errorMessage } from '@/utils/errors.js';

import {
  CLEARED_CALL,
  fillFreeTables,
  getMatch,
  onTableFreed,
  setTechnicalResult,
} from './matchService.js';
import { getTournament } from './tournamentService.js';
import { getMatchDecisionRecipients } from './refereeService.js';
import {
  notifyCallReminder,
  notifyMarkedAbsent,
  notifyMatchStart,
  notifyNoShowAlert,
  notifyOpponentAtTable,
} from './notificationService.js';
import { MATCH_CALL_EXTEND_MS } from './matchCall.const.js';

/**
 * Call-to-table lifecycle (single_day auto-seating). assignTableAndCall gives a
 * match a table and calls its players; from here:
 *   - both press «Я у стола» → markPlayerReady starts the match;
 *   - the deadline passes → processOverdueCalls alerts the referee, who
 *     starts it anyway (startMatch), extends the wait (extendCall), postpones
 *     it (postponeCalledMatch) or gives a technical loss (noShowTechnicalLoss).
 * Nothing is decided automatically.
 */

type CallResult = { success: true } | { success: false; error: string };

const NOT_CALLED_ERROR = 'Матч не ожидает явки игроков';

function isCalled(match: MatchWithPlayers): boolean {
  return (
    match.status === 'scheduled' &&
    match.tableId !== null &&
    match.calledAt !== null
  );
}

/** Conditions of a called match row, for conditional UPDATEs. */
function calledMatch(matchId: UUID) {
  return and(
    eq(matches.id, matchId),
    eq(matches.status, 'scheduled'),
    isNotNull(matches.calledAt),
  );
}

/**
 * A called player confirms they're at the table. When the second player
 * confirms, the match starts (`in_progress`); the conditional UPDATE makes
 * exactly one of two simultaneous presses perform the transition. Also clears
 * the player's absent mark — they evidently are here.
 */
export async function markPlayerReady(
  matchId: UUID,
  userId: UUID,
  botApi?: Api,
): Promise<
  { success: true; started: boolean } | { success: false; error: string }
> {
  const match = await getMatch(matchId);
  if (!match) return { success: false, error: 'Матч не найден' };
  if (match.player1Id !== userId && match.player2Id !== userId) {
    return { success: false, error: 'Вы не участник этого матча' };
  }
  if (match.status === 'in_progress') {
    return { success: false, error: 'Матч уже идёт' };
  }
  if (!isCalled(match)) return { success: false, error: NOT_CALLED_ERROR };

  const readyCol =
    match.player1Id === userId
      ? matches.player1ReadyAt
      : matches.player2ReadyAt;
  const readyKey =
    match.player1Id === userId ? 'player1ReadyAt' : 'player2ReadyAt';
  const now = new Date();

  // A repeated press leaves the first timestamp alone; zero rows here is fine
  // as long as the match is still called (checked by the start UPDATE below).
  await db
    .update(matches)
    .set({ [readyKey]: now, updatedAt: now })
    .where(and(calledMatch(matchId), isNull(readyCol)));

  await db
    .update(tournamentParticipants)
    .set({ absentSince: null })
    .where(
      and(
        eq(tournamentParticipants.tournamentId, match.tournamentId),
        eq(tournamentParticipants.userId, userId),
      ),
    );

  const started = await db
    .update(matches)
    .set({ status: 'in_progress', startedAt: now, updatedAt: now })
    .where(
      and(
        calledMatch(matchId),
        isNotNull(matches.player1ReadyAt),
        isNotNull(matches.player2ReadyAt),
      ),
    )
    .returning({ id: matches.id });

  const after = await getMatch(matchId);
  if (!after) return { success: false, error: 'Матч не найден' };
  if (!started.length && !isCalled(after) && after.status !== 'in_progress') {
    // Postponed / decided by the referee between our read and write.
    return { success: false, error: NOT_CALLED_ERROR };
  }

  if (botApi) {
    try {
      if (started.length) {
        const tournament = await getTournament(after.tournamentId);
        await notifyMatchStart(botApi, after, tournament?.name ?? '', '');
      } else if (isCalled(after)) {
        const opponentReady =
          match.player1Id === userId
            ? after.player2ReadyAt
            : after.player1ReadyAt;
        if (!opponentReady) await notifyOpponentAtTable(botApi, after, userId);
      }
    } catch (err) {
      console.error(`markPlayerReady(${matchId}) notify: ${errorMessage(err)}`);
    }
  }

  return { success: true, started: started.length > 0 };
}

/**
 * Sweep: alert the referee about every called match of a running tournament
 * whose presence deadline has passed, and re-ping the players who haven't
 * confirmed. State lives in the DB (`noShowAlertedAt`, claimed by a
 * conditional UPDATE), so each deadline alerts exactly once — across
 * overlapping sweeps and restarts. Returns how many matches were alerted.
 */
export async function processOverdueCalls(
  botApi: Api,
  now = new Date(),
): Promise<number> {
  const overdue = await db
    .select({ id: matches.id })
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .where(
      and(
        eq(matches.status, 'scheduled'),
        isNotNull(matches.calledAt),
        isNotNull(matches.tableId),
        isNull(matches.noShowAlertedAt),
        lt(matches.callDeadlineAt, now),
        eq(tournaments.status, 'in_progress'),
      ),
    );

  let alerted = 0;
  for (const { id } of overdue) {
    try {
      const claimed = await db
        .update(matches)
        .set({ noShowAlertedAt: now })
        .where(and(calledMatch(id), isNull(matches.noShowAlertedAt)))
        .returning({ id: matches.id });
      if (!claimed.length) continue;
      alerted += 1;

      const match = await getMatch(id);
      if (!match) continue;
      const tournament = await getTournament(match.tournamentId);
      const recipients = await getMatchDecisionRecipients(match.tournamentId);
      await notifyNoShowAlert(
        botApi,
        match,
        tournament?.name ?? '',
        recipients,
      );

      for (const [playerId, readyAt] of [
        [match.player1Id, match.player1ReadyAt],
        [match.player2Id, match.player2ReadyAt],
      ] as const) {
        if (playerId && !readyAt) {
          await notifyCallReminder(botApi, match, playerId);
        }
      }
    } catch (err) {
      console.error(`processOverdueCalls(${id}): ${errorMessage(err)}`);
    }
  }
  return alerted;
}

/** Players of a called match who haven't confirmed presence. */
function playersNotReady(match: MatchWithPlayers): UUID[] {
  return [
    match.player1ReadyAt ? null : match.player1Id,
    match.player2ReadyAt ? null : match.player2Id,
  ].filter((id): id is UUID => id !== null);
}

/**
 * Referee: give the wait «+5 мин». Re-arms the alert for the new deadline.
 */
export async function extendCall(matchId: UUID): Promise<CallResult> {
  const match = await getMatch(matchId);
  if (!match || !isCalled(match)) {
    return { success: false, error: NOT_CALLED_ERROR };
  }

  const now = Date.now();
  const base = Math.max(match.callDeadlineAt?.getTime() ?? now, now);
  const updated = await db
    .update(matches)
    .set({
      callDeadlineAt: new Date(base + MATCH_CALL_EXTEND_MS),
      noShowAlertedAt: null,
      updatedAt: new Date(now),
    })
    .where(calledMatch(matchId))
    .returning({ id: matches.id });

  if (!updated.length) return { success: false, error: NOT_CALLED_ERROR };
  return { success: true };
}

/**
 * Referee: postpone a called match. Its table goes to the next ready match
 * right away, the match keeps its queue position, and whoever hadn't
 * confirmed presence is marked absent — the queue skips their matches until
 * they report back (markParticipantPresent / «Я на месте»).
 */
export async function postponeCalledMatch(
  matchId: UUID,
  botApi?: Api,
): Promise<
  { success: true; absentPlayerIds: UUID[] } | { success: false; error: string }
> {
  const match = await getMatch(matchId);
  if (!match || !isCalled(match) || !match.tableId) {
    return { success: false, error: NOT_CALLED_ERROR };
  }
  const tableId = match.tableId;
  const absentPlayerIds = playersNotReady(match);
  const now = new Date();

  const released = await db.transaction(async (tx) => {
    const rows = await tx
      .update(matches)
      .set({ ...CLEARED_CALL, tableId: null, updatedAt: now })
      .where(calledMatch(matchId))
      .returning({ id: matches.id });
    if (!rows.length) return false;

    if (absentPlayerIds.length > 0) {
      await tx
        .update(tournamentParticipants)
        .set({ absentSince: now })
        .where(
          and(
            eq(tournamentParticipants.tournamentId, match.tournamentId),
            inArray(tournamentParticipants.userId, absentPlayerIds),
          ),
        );
    }
    return true;
  });

  if (!released) {
    return { success: false, error: 'Матч уже начат или снят со стола' };
  }

  if (botApi) {
    try {
      const tournament = await getTournament(match.tournamentId);
      for (const userId of absentPlayerIds) {
        await notifyMarkedAbsent(
          botApi,
          userId,
          match.tournamentId,
          tournament?.name ?? '',
        );
      }
    } catch (err) {
      console.error(
        `postponeCalledMatch(${matchId}) notify: ${errorMessage(err)}`,
      );
    }
    await onTableFreed(match.tournamentId, tableId, botApi);
  }

  return { success: true, absentPlayerIds };
}

/**
 * Referee: technical loss for the player in `absentSlot` who didn't show up.
 * The loser is marked absent first, so the table hand-off triggered by the
 * result doesn't immediately call their next match (DE losers bracket,
 * round-robin); the mark is dropped again if they have nothing left to play.
 */
export async function noShowTechnicalLoss(
  matchId: UUID,
  absentSlot: 1 | 2,
  setById: UUID,
  botApi?: Api,
): Promise<CallResult> {
  const match = await getMatch(matchId);
  if (!match) return { success: false, error: 'Матч не найден' };
  const loserId = absentSlot === 1 ? match.player1Id : match.player2Id;
  const winnerId = absentSlot === 1 ? match.player2Id : match.player1Id;
  if (!loserId || !winnerId) {
    return { success: false, error: 'В матче нет второго игрока' };
  }

  const markLoser = (absentSince: Date | null) =>
    db
      .update(tournamentParticipants)
      .set({ absentSince })
      .where(
        and(
          eq(tournamentParticipants.tournamentId, match.tournamentId),
          eq(tournamentParticipants.userId, loserId),
        ),
      );

  await markLoser(new Date());
  const result = await setTechnicalResult(
    matchId,
    winnerId,
    'Неявка соперника',
    setById,
    botApi,
  );
  if (!result.success) {
    await markLoser(null);
    return { success: false, error: result.error ?? 'Ошибка' };
  }

  const [remaining] = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, match.tournamentId),
        inArray(matches.status, ['scheduled', 'in_progress']),
        or(eq(matches.player1Id, loserId), eq(matches.player2Id, loserId)),
      ),
    )
    .limit(1);

  if (!remaining) {
    await markLoser(null);
  } else if (botApi) {
    try {
      const tournament = await getTournament(match.tournamentId);
      await notifyMarkedAbsent(
        botApi,
        loserId,
        match.tournamentId,
        tournament?.name ?? '',
      );
    } catch (err) {
      console.error(
        `noShowTechnicalLoss(${matchId}) notify: ${errorMessage(err)}`,
      );
    }
  }

  return { success: true };
}

/**
 * A player marked absent reports back («Я на месте», or a referee/admin does it
 * for them). Their waiting matches become eligible again, so free tables are
 * re-filled right away.
 */
export async function markParticipantPresent(
  tournamentId: UUID,
  userId: UUID,
  botApi?: Api,
): Promise<
  { success: true; wasAbsent: boolean } | { success: false; error: string }
> {
  const updated = await db
    .update(tournamentParticipants)
    .set({ absentSince: null })
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        eq(tournamentParticipants.userId, userId),
        isNotNull(tournamentParticipants.absentSince),
      ),
    )
    .returning({ userId: tournamentParticipants.userId });

  if (updated.length && botApi) {
    try {
      await fillFreeTables(tournamentId, botApi);
    } catch (err) {
      console.error(
        `markParticipantPresent(${tournamentId}): ${errorMessage(err)}`,
      );
    }
  }

  return { success: true, wasAbsent: updated.length > 0 };
}
