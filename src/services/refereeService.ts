import { and, asc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import {
  matches,
  tournamentParticipants,
  tournamentReferees,
  tournaments,
  users,
} from '@/db/schema.js';
import type { IUserRole } from '@/db/schema.js';

/**
 * Referee permissions and read-models, shared by the bot and the player-site
 * referee section. A referee is not a role: it is a per-tournament row in
 * `tournament_referees`. Admins may manage every tournament.
 *
 * Imports only `db` + schema on purpose, so notificationService / matchService
 * can depend on it without an import cycle.
 */

type Tournament = typeof tournaments.$inferSelect;

/** The part of a user the permission checks need (DbUser / AppUser both fit). */
export interface RefereeActor {
  id: UUID;
  role: IUserRole;
}

/** Match statuses a referee can still act on. */
export const ACTIVE_MATCH_STATUSES = [
  'scheduled',
  'in_progress',
  'pending_confirmation',
] as const;

/** Tournament statuses shown in a referee's list (not started ones read-only). */
const REFEREE_TOURNAMENT_STATUSES = [
  'registration_open',
  'registration_closed',
  'in_progress',
] as const;

export async function isTournamentRefereeUser(
  userId: UUID,
  tournamentId: UUID,
): Promise<boolean> {
  const [row] = await db
    .select({ userId: tournamentReferees.userId })
    .from(tournamentReferees)
    .where(
      and(
        eq(tournamentReferees.tournamentId, tournamentId),
        eq(tournamentReferees.userId, userId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Admin, or a referee of this tournament. */
export async function canManageTournamentAsUser(
  user: RefereeActor,
  tournamentId: UUID,
): Promise<boolean> {
  if (user.role === 'admin') return true;
  return isTournamentRefereeUser(user.id, tournamentId);
}

export async function getUserRefereeTournamentIds(
  userId: UUID,
): Promise<UUID[]> {
  const rows = await db
    .select({ tournamentId: tournamentReferees.tournamentId })
    .from(tournamentReferees)
    .where(eq(tournamentReferees.userId, userId));
  return rows.map((r) => r.tournamentId);
}

/**
 * Who decides a match-level incident (no-show, disputed result): the
 * tournament's referees, or its creator when no referee is assigned.
 * `byReferees` tells the two apart, so player-facing text can say whom to
 * turn to.
 */
export async function getMatchDecisionMakers(
  tournamentId: UUID,
): Promise<{ userIds: UUID[]; byReferees: boolean }> {
  const referees = await db
    .select({ userId: tournamentReferees.userId })
    .from(tournamentReferees)
    .where(eq(tournamentReferees.tournamentId, tournamentId));
  if (referees.length > 0) {
    return { userIds: referees.map((r) => r.userId), byReferees: true };
  }

  const [tournament] = await db
    .select({ createdBy: tournaments.createdBy })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));
  return {
    userIds: tournament ? [tournament.createdBy] : [],
    byReferees: false,
  };
}

export async function getMatchDecisionRecipients(
  tournamentId: UUID,
): Promise<UUID[]> {
  return (await getMatchDecisionMakers(tournamentId)).userIds;
}

export interface RefereeTournamentCounts {
  inProgress: number;
  pending: number;
  /** Waiting for a table: scheduled, both players known, no table yet. */
  queued: number;
  /** Called to a table, players not both confirmed yet. */
  called: number;
  overdueCalls: number;
  disputed: number;
}

export interface RefereeTournamentSummary {
  id: UUID;
  name: string;
  status: Tournament['status'];
  scheduleMode: Tournament['scheduleMode'];
  discipline: Tournament['discipline'];
  format: Tournament['format'];
  winScore: number;
  counts: RefereeTournamentCounts;
}

const EMPTY_COUNTS: RefereeTournamentCounts = {
  inProgress: 0,
  pending: 0,
  queued: 0,
  called: 0,
  overdueCalls: 0,
  disputed: 0,
};

/** Tournament ids a user may referee right now (see REFEREE_TOURNAMENT_STATUSES). */
async function refereeTournamentScope(
  user: RefereeActor,
): Promise<Tournament[]> {
  const refereeIds = await getUserRefereeTournamentIds(user.id);
  const own =
    refereeIds.length > 0
      ? and(
          inArray(tournaments.id, refereeIds),
          inArray(tournaments.status, REFEREE_TOURNAMENT_STATUSES),
        )
      : undefined;
  // Admins see every running tournament, plus the ones they referee.
  const where =
    user.role === 'admin'
      ? or(eq(tournaments.status, 'in_progress'), own)
      : own;
  if (!where) return [];

  return db
    .select()
    .from(tournaments)
    .where(where)
    .orderBy(asc(tournaments.startDate), asc(tournaments.name));
}

/**
 * Tournaments shown on the referee home screen, with per-tournament counts of
 * the matches that need attention. Counts come from one grouped query.
 */
export async function getRefereeTournaments(
  user: RefereeActor,
  now = new Date(),
): Promise<RefereeTournamentSummary[]> {
  const list = await refereeTournamentScope(user);
  if (list.length === 0) return [];

  const isCalled = sql`${matches.status} = 'scheduled' and ${matches.calledAt} is not null`;
  const rows = await db
    .select({
      tournamentId: matches.tournamentId,
      inProgress: sql<number>`count(*) filter (where ${matches.status} = 'in_progress')::int`,
      pending: sql<number>`count(*) filter (where ${matches.status} = 'pending_confirmation')::int`,
      queued: sql<number>`count(*) filter (where ${matches.status} = 'scheduled' and ${matches.tableId} is null and ${matches.player1Id} is not null and ${matches.player2Id} is not null)::int`,
      called: sql<number>`count(*) filter (where ${isCalled})::int`,
      // lt() (not a raw `< ${now}`) so the Date goes through the column's
      // encoder — the columns are timezone-less `timestamp`.
      overdueCalls: sql<number>`count(*) filter (where ${isCalled} and ${lt(matches.callDeadlineAt, now)})::int`,
      disputed: sql<number>`count(*) filter (where ${matches.disputedAt} is not null)::int`,
    })
    .from(matches)
    .where(
      and(
        inArray(
          matches.tournamentId,
          list.map((t) => t.id),
        ),
        inArray(matches.status, ACTIVE_MATCH_STATUSES),
      ),
    )
    .groupBy(matches.tournamentId);

  const byTournament = new Map(rows.map((r) => [r.tournamentId, r]));
  return list.map((t) => {
    const r = byTournament.get(t.id);
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      scheduleMode: t.scheduleMode,
      discipline: t.discipline,
      format: t.format,
      winScore: t.winScore,
      counts: r
        ? {
            inProgress: r.inProgress,
            pending: r.pending,
            queued: r.queued,
            called: r.called,
            overdueCalls: r.overdueCalls,
            disputed: r.disputed,
          }
        : { ...EMPTY_COUNTS },
    };
  });
}

export type RefereeAttentionReason = 'disputed' | 'overdue_call';

export interface RefereeAttentionItem {
  matchId: UUID;
  tournamentId: UUID;
  reason: RefereeAttentionReason;
}

/**
 * Active matches of the user's running tournaments that need a referee
 * decision: a disputed result, or a call to the table whose deadline passed.
 * Disputes first, then the longest-overdue calls.
 */
export async function getRefereeAttention(
  user: RefereeActor,
  now = new Date(),
): Promise<RefereeAttentionItem[]> {
  const running = (await refereeTournamentScope(user)).filter(
    (t) => t.status === 'in_progress',
  );
  if (running.length === 0) return [];

  const rows = await db
    .select({
      matchId: matches.id,
      tournamentId: matches.tournamentId,
      disputedAt: matches.disputedAt,
      callDeadlineAt: matches.callDeadlineAt,
    })
    .from(matches)
    .where(
      and(
        inArray(
          matches.tournamentId,
          running.map((t) => t.id),
        ),
        inArray(matches.status, ACTIVE_MATCH_STATUSES),
        or(
          isNotNull(matches.disputedAt),
          and(
            eq(matches.status, 'scheduled'),
            isNotNull(matches.calledAt),
            lt(matches.callDeadlineAt, now),
          ),
        ),
      ),
    )
    .orderBy(asc(matches.disputedAt), asc(matches.callDeadlineAt));

  const items = rows.map(
    (r): RefereeAttentionItem => ({
      matchId: r.matchId,
      tournamentId: r.tournamentId,
      reason: r.disputedAt ? 'disputed' : 'overdue_call',
    }),
  );
  // Stable: disputes keep their disputedAt order, calls their deadline order.
  return [
    ...items.filter((i) => i.reason === 'disputed'),
    ...items.filter((i) => i.reason === 'overdue_call'),
  ];
}

export interface AbsentParticipant {
  userId: UUID;
  username: string;
  name: string | null;
  surname: string | null;
  absentSince: Date;
}

/** Participants marked absent (postponed no-show) — the queue skips them. */
export async function getAbsentParticipants(
  tournamentId: UUID,
): Promise<AbsentParticipant[]> {
  const rows = await db
    .select({
      userId: tournamentParticipants.userId,
      username: users.username,
      name: users.name,
      surname: users.surname,
      absentSince: tournamentParticipants.absentSince,
    })
    .from(tournamentParticipants)
    .innerJoin(users, eq(tournamentParticipants.userId, users.id))
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        isNotNull(tournamentParticipants.absentSince),
      ),
    )
    .orderBy(asc(tournamentParticipants.absentSince));
  return rows.flatMap((r) =>
    r.absentSince ? [{ ...r, absentSince: r.absentSince }] : [],
  );
}
