import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import { randomBytes } from 'crypto';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import {
  matches,
  tournamentTables,
  tournaments,
  tournamentParticipants,
  users,
  venues,
} from '@/db/schema.js';
import type {
  ITournamentDiscipline,
  ITournamentFormat,
  ITournamentMaxParticipants,
  ITournamentScheduleMode,
  ITournamentVisibility,
  ITournamentWinScore,
} from '@/db/schema.js';
import type {
  TournamentStatus,
  TournamentParticipant,
  TournamentReadModel,
} from '@/bot/@types/tournament.js';

import { shuffleArray } from './bracketGenerator.js';
import { validateTableIdsForVenue } from './tableService.js';

export interface StartTournamentResult {
  canStart: boolean;
  error?: string;
  participantsCount: number;
}

export interface CreateTournamentDraftInput {
  venueId: UUID;

  name: string;
  description?: string | null;
  discipline: ITournamentDiscipline;
  format: ITournamentFormat;
  randomAdvancement?: boolean;
  visibility?: ITournamentVisibility;
  scheduleMode?: ITournamentScheduleMode;
  startDate?: Date | null;
  maxParticipants: ITournamentMaxParticipants;
  winScore: ITournamentWinScore;
  mergeRound?: number;
  rules?: string | null;
  createdBy: UUID;

  tableIds?: UUID[];
}

export interface UpdateTournamentDraftInput {
  venueId: UUID;

  name: string;
  description?: string | null;
  format: ITournamentFormat;
  randomAdvancement?: boolean;
  visibility?: ITournamentVisibility;
  scheduleMode?: ITournamentScheduleMode;
  startDate?: Date | null;
  maxParticipants: ITournamentMaxParticipants;
  winScore: ITournamentWinScore;
  mergeRound?: number;
  rules?: string | null;

  tableIds?: UUID[];
}

// Live participant counts, computed as scalar correlated subqueries so they stay
// correct even where the outer query already joins tournamentParticipants (e.g.
// getUserTournaments) — a GROUP BY aggregate would be skewed by that join.
const confirmedParticipantsLive = sql<number>`(
  select count(*)::int from ${tournamentParticipants}
  where ${tournamentParticipants.tournamentId} = ${tournaments.id}
    and ${tournamentParticipants.status} = 'confirmed'
)`;
const pendingParticipantsLive = sql<number>`(
  select count(*)::int from ${tournamentParticipants}
  where ${tournamentParticipants.tournamentId} = ${tournaments.id}
    and ${tournamentParticipants.status} = 'pending'
)`;

const tournamentReadColumns = {
  ...getTableColumns(tournaments),
  venueName: venues.name,
  confirmedCount: confirmedParticipantsLive,
  pendingCount: pendingParticipantsLive,
};

export interface TournamentViewer {
  isAdmin: boolean;
  isReferee: boolean;
  isParticipant: boolean;
  isCreator: boolean;
}

/**
 * Pure visibility predicate: can the given viewer see this tournament?
 *
 * Public tournaments are visible to everyone. A private (invite-only)
 * tournament is visible only to admins, its referees, its participants
 * (incl. invited) and its creator. Kept side-effect free so it can be unit
 * tested; the DB lookups for the viewer flags live in the calling layer
 * (see `canViewTournament` in bot/permissions).
 */
export function isTournamentVisibleTo(
  tournament: { visibility: ITournamentVisibility },
  viewer: TournamentViewer,
): boolean {
  if (tournament.visibility === 'public') return true;

  return (
    viewer.isAdmin ||
    viewer.isReferee ||
    viewer.isParticipant ||
    viewer.isCreator
  );
}

/**
 * Check if tournament can be started
 */
export async function canStartTournament(
  tournamentId: UUID,
): Promise<StartTournamentResult> {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    return { canStart: false, error: 'Турнир не найден', participantsCount: 0 };
  }

  if (tournament.status !== 'registration_closed') {
    return {
      canStart: false,
      error: "Турнир должен иметь статус 'Регистрация закрыта' для запуска",
      participantsCount: 0,
    };
  }

  const participants = await getConfirmedParticipants(tournamentId);
  const count = participants.length;

  if (count < 2) {
    return {
      canStart: false,
      error: `Недостаточно участников для запуска турнира (минимум 2, сейчас ${String(count)})`,
      participantsCount: count,
    };
  }

  const seedError = validateSeeds(participants, count);
  if (seedError) {
    return { canStart: false, error: seedError, participantsCount: count };
  }

  return { canStart: true, participantsCount: count };
}

export function validateSeeds(
  participants: TournamentParticipant[],
  count: number,
): string | null {
  const seen = new Set<number>();
  for (const p of participants) {
    if (p.seed == null) continue;
    if (p.seed < 1 || p.seed > count) {
      return `Сид ${String(p.seed)} выходит за диапазон 1..${String(count)}`;
    }
    if (seen.has(p.seed)) {
      return `Сид ${String(p.seed)} задан нескольким участникам`;
    }
    seen.add(p.seed);
  }
  return null;
}

/**
 * Get confirmed participants for a tournament with user info
 */
export async function getConfirmedParticipants(
  tournamentId: UUID,
): Promise<TournamentParticipant[]> {
  const participants = await db
    .select({
      userId: tournamentParticipants.userId,
      username: users.username,
      name: users.name,
      seed: tournamentParticipants.seed,
      createdAt: tournamentParticipants.createdAt,
    })
    .from(tournamentParticipants)
    .innerJoin(users, eq(tournamentParticipants.userId, users.id))
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        eq(tournamentParticipants.status, 'confirmed'),
      ),
    )
    .orderBy(asc(tournamentParticipants.createdAt));

  return participants.map((p) => ({
    userId: p.userId,
    username: p.username,
    name: p.name,
    seed: p.seed,
  }));
}

/**
 * Start tournament - change status to in_progress
 */
export async function startTournament(tournamentId: UUID): Promise<void> {
  // Get tournament to check format
  const tournament = await getTournament(tournamentId);
  if (!tournament) {
    throw new Error('Tournament not found');
  }

  // Validate double elimination participant count (8–128).
  if (tournament.format === 'double_elimination') {
    const participants = await getConfirmedParticipants(tournamentId);
    if (participants.length < 8 || participants.length > 128) {
      throw new Error(
        'Double elimination поддерживает 8–128 участников. ' +
          `Текущее количество: ${String(participants.length)}`,
      );
    }
  }

  await db
    .update(tournaments)
    .set({
      status: 'in_progress',
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));
}

/**
 * Создает черновик турнира
 *
 * @throws {Error} Если не удалось найти площадку с указанным id
 * @throws {Error} Если не удалось создать турнир
 * @throws {Error} Если не удалось загрузить турнир после создания
 *
 * @param {CreateTournamentDraftInput} input Данные для создания турнира
 *
 * @returns {Promise<TournamentReadModel>} Созданный турнир
 *
 */
export async function createTournamentDraft(
  input: CreateTournamentDraftInput,
): Promise<TournamentReadModel> {
  const venue = await db.query.venues.findFirst({
    where: eq(venues.id, input.venueId),
  });

  if (!venue) throw new Error('Площадка не найдена');

  const uniqueTableIds = Array.from(new Set(input.tableIds ?? []));

  await validateTableIdsForVenue(uniqueTableIds, input.venueId);

  const created = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(tournaments)
      .values({
        venueId: input.venueId,

        name: input.name,
        description: input.description ?? null,
        discipline: input.discipline,
        format: input.format,
        randomAdvancement: input.randomAdvancement ?? false,
        visibility: input.visibility ?? 'public',
        scheduleMode: input.scheduleMode ?? 'single_day',
        status: 'draft',
        startDate: input.startDate ?? null,
        maxParticipants: input.maxParticipants,
        winScore: input.winScore,
        mergeRound: input.mergeRound ?? 2,
        rules: input.rules ?? null,
        createdBy: input.createdBy,
      })
      .returning({ id: tournaments.id });

    if (!inserted) throw new Error('Ошибка создания турнира');

    if (uniqueTableIds.length > 0) {
      await tx.insert(tournamentTables).values(
        uniqueTableIds.map((tableId, position) => ({
          tournamentId: inserted.id,
          tableId,
          position,
        })),
      );
    }

    return inserted;
  });

  const tournament = await getTournament(created.id);

  if (!tournament) throw new Error('Ошибка загрузки турнира после создания');

  return tournament;
}

/**
 * Update an existing tournament while it is still editable (before start — see
 * {@link EDITABLE_STATUSES}). Mirrors {@link createTournamentDraft}: validates
 * the venue and table selection, then rewrites the editable fields and replaces
 * the table assignment atomically. Status, discipline and ownership are never
 * changed here. The participant cap cannot be set below the people already
 * signed up.
 *
 * @throws {Error} Если турнир не найден.
 * @throws {Error} Если турнир уже стартовал и не может быть отредактирован.
 * @throws {Error} Если площадка не найдена или столы ей не принадлежат.
 * @throws {Error} Если новый лимит меньше текущего числа участников.
 *
 * @param {UUID} id Идентификатор турнира
 * @param {UpdateTournamentDraftInput} input Новые данные турнира
 *
 * @returns {Promise<TournamentReadModel>} Обновлённый турнир
 */
export async function updateTournamentDraft(
  id: UUID,
  input: UpdateTournamentDraftInput,
): Promise<TournamentReadModel> {
  const existing = await getTournament(id);

  if (!existing) throw new Error('Турнир не найден');

  if (!canEditTournament(existing.status)) {
    throw new Error('Турнир уже стартовал — редактирование недоступно');
  }

  const venue = await db.query.venues.findFirst({
    where: eq(venues.id, input.venueId),
  });

  if (!venue) throw new Error('Площадка не найдена');

  const uniqueTableIds = Array.from(new Set(input.tableIds ?? []));

  await validateTableIdsForVenue(uniqueTableIds, input.venueId);

  // The participant cap is only enforced at registration time, so the edit form
  // is the one place it could be lowered below the people already signed up.
  const [active] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, id),
        inArray(tournamentParticipants.status, ['pending', 'confirmed']),
      ),
    );
  const activeCount = active?.count ?? 0;

  if (input.maxParticipants < activeCount) {
    throw new Error(
      `Нельзя установить лимит участников меньше текущего числа участников (${String(activeCount)})`,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(tournaments)
      .set({
        venueId: input.venueId,
        name: input.name,
        description: input.description ?? null,
        format: input.format,
        randomAdvancement: input.randomAdvancement ?? false,
        visibility: input.visibility ?? 'public',
        scheduleMode: input.scheduleMode ?? 'single_day',
        startDate: input.startDate ?? null,
        maxParticipants: input.maxParticipants,
        winScore: input.winScore,
        mergeRound: input.mergeRound ?? 2,
        rules: input.rules ?? null,
        updatedAt: new Date(),
      })
      .where(eq(tournaments.id, id));

    await tx
      .delete(tournamentTables)
      .where(eq(tournamentTables.tournamentId, id));

    if (uniqueTableIds.length > 0) {
      await tx.insert(tournamentTables).values(
        uniqueTableIds.map((tableId, position) => ({
          tournamentId: id,
          tableId,
          position,
        })),
      );
    }
  });

  const tournament = await getTournament(id);

  if (!tournament) throw new Error('Ошибка загрузки турнира после обновления');

  return tournament;
}

/**
 * Complete tournament with winner
 */
export async function completeTournament(tournamentId: UUID): Promise<void> {
  await db
    .update(tournaments)
    .set({
      status: 'completed',
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));
}

/**
 * Get tournament by ID
 */
export async function getTournament(
  tournamentId: UUID,
): Promise<TournamentReadModel | null> {
  const [rows] = await db
    .select(tournamentReadColumns)
    .from(tournaments)
    .leftJoin(venues, eq(tournaments.venueId, venues.id))
    .where(eq(tournaments.id, tournamentId));

  return rows ?? null;
}

/**
 * Look up a tournament by its shareable invite code (the `join_<code>` deep
 * link payload). Returns null for unknown codes.
 */
export async function getTournamentByInviteCode(
  code: string,
): Promise<TournamentReadModel | null> {
  const [rows] = await db
    .select(tournamentReadColumns)
    .from(tournaments)
    .leftJoin(venues, eq(tournaments.venueId, venues.id))
    .where(eq(tournaments.inviteCode, code));

  return rows ?? null;
}

/**
 * Return the tournament's invite code, generating and persisting one on first
 * use. Idempotent: repeated calls return the same code, and a concurrent
 * generation is reconciled by re-reading the row.
 *
 * @throws {Error} If the tournament does not exist.
 */
export async function ensureInviteCode(tournamentId: UUID): Promise<string> {
  const existing = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
    columns: { inviteCode: true },
  });

  if (!existing) throw new Error('Турнир не найден');
  if (existing.inviteCode) return existing.inviteCode;

  // 6 random bytes → 8 url-safe chars; collision probability is negligible.
  const code = randomBytes(6).toString('base64url');

  const [updated] = await db
    .update(tournaments)
    .set({ inviteCode: code })
    .where(
      and(eq(tournaments.id, tournamentId), isNull(tournaments.inviteCode)),
    )
    .returning({ inviteCode: tournaments.inviteCode });

  if (updated?.inviteCode) return updated.inviteCode;

  // Lost a race with a concurrent generation — re-read the persisted code.
  const reread = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
    columns: { inviteCode: true },
  });

  if (reread?.inviteCode) return reread.inviteCode;

  throw new Error('Не удалось сгенерировать код приглашения');
}

/**
 * Get confirmed participants ordered by seed (NULLS LAST), then by createdAt.
 * Used by tournament start to feed bracket generators a seed-ordered array.
 */
export async function getConfirmedParticipantsBySeed(
  tournamentId: UUID,
): Promise<TournamentParticipant[]> {
  const rows = await db
    .select({
      userId: tournamentParticipants.userId,
      username: users.username,
      name: users.name,
      seed: tournamentParticipants.seed,
    })
    .from(tournamentParticipants)
    .innerJoin(users, eq(tournamentParticipants.userId, users.id))
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        eq(tournamentParticipants.status, 'confirmed'),
      ),
    )
    .orderBy(
      sql`${tournamentParticipants.seed} ASC NULLS LAST`,
      asc(tournamentParticipants.createdAt),
    );

  return rows;
}

/**
 * Fill in missing seeds: keep valid manual seeds (1..N, no duplicates), assign
 * remaining free numbers randomly to participants without a seed.
 *
 * Contract: caller must validate via canStartTournament beforehand. After this
 * call every confirmed participant has a unique seed in 1..N.
 */
export async function fillMissingSeeds(tournamentId: UUID): Promise<void> {
  const participants = await getConfirmedParticipants(tournamentId);
  const N = participants.length;
  if (N === 0) return;

  const usedSeeds = new Set<number>();
  for (const p of participants) {
    if (p.seed != null) usedSeeds.add(p.seed);
  }

  const freeSeeds: number[] = [];
  for (let s = 1; s <= N; s++) {
    if (!usedSeeds.has(s)) freeSeeds.push(s);
  }
  const shuffledFree = shuffleArray(freeSeeds);

  const unseeded = participants.filter((p) => p.seed == null);

  await db.transaction(async (tx) => {
    for (const participant of unseeded) {
      const seed = shuffledFree.pop();
      if (seed == null) break;
      await tx
        .update(tournamentParticipants)
        .set({ seed })
        .where(
          and(
            eq(tournamentParticipants.tournamentId, tournamentId),
            eq(tournamentParticipants.userId, participant.userId),
          ),
        );
    }
  });
}

/**
 * Set seed for a single confirmed participant. Duplicates are allowed at this
 * layer — they are surfaced to the admin UI as red highlights and blocked at
 * tournament start via canStartTournament.
 */
export async function setParticipantSeed(
  tournamentId: UUID,
  userId: UUID,
  seed: number | null,
): Promise<void> {
  if (seed != null && (!Number.isInteger(seed) || seed < 1)) {
    throw new Error('Сид должен быть целым числом ≥ 1');
  }

  const [existing] = await db
    .select({ status: tournamentParticipants.status })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        eq(tournamentParticipants.userId, userId),
      ),
    );

  if (!existing) throw new Error('Участник не найден');
  if (existing.status !== 'confirmed') {
    throw new Error('Сиды доступны только подтверждённым участникам');
  }

  await db
    .update(tournamentParticipants)
    .set({ seed })
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        eq(tournamentParticipants.userId, userId),
      ),
    );
}

/**
 * Reset all confirmed participants' seeds and reassign randomly.
 */
export async function randomizeSeeds(tournamentId: UUID): Promise<void> {
  await db
    .update(tournamentParticipants)
    .set({ seed: null })
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        eq(tournamentParticipants.status, 'confirmed'),
      ),
    );
  await fillMissingSeeds(tournamentId);
}

/**
 * Get tournaments with optional filtering.
 *
 * `statuses` (when provided) restricts the result to those statuses at the DB
 * level. It takes precedence over `includesDrafts`. Capped at `limit` (default
 * 10) — there is no pagination, so callers relying on the cap should be aware
 * older rows beyond the limit are not returned.
 */
export async function getTournaments(options?: {
  limit?: number;
  includesDrafts?: boolean;
  statuses?: TournamentStatus[];
  includePrivate?: boolean;
}): Promise<TournamentReadModel[]> {
  const {
    limit = 10,
    includesDrafts = true,
    statuses,
    includePrivate = false,
  } = options ?? {};

  const statusWhere = statuses
    ? inArray(tournaments.status, statuses)
    : includesDrafts
      ? undefined
      : sql`${tournaments.status} <> 'draft'`;

  // Private (invite-only) tournaments are hidden from general listings unless
  // explicitly requested (admin views, dashboard). They surface for their
  // participants via getUserTournaments instead.
  const where = includePrivate
    ? statusWhere
    : and(statusWhere, eq(tournaments.visibility, 'public'));

  return db
    .select(tournamentReadColumns)
    .from(tournaments)
    .leftJoin(venues, eq(tournaments.venueId, venues.id))
    .where(where)
    .orderBy(desc(tournaments.createdAt))
    .limit(limit);
}

/**
 * Get tournaments the user is registered in (participant status pending or
 * confirmed), most recent first. Capped at `limit` (default 10).
 */
export async function getUserTournaments(
  userId: UUID,
  options?: { limit?: number },
): Promise<TournamentReadModel[]> {
  const { limit = 10 } = options ?? {};

  return db
    .select(tournamentReadColumns)
    .from(tournaments)
    .leftJoin(venues, eq(tournaments.venueId, venues.id))
    .innerJoin(
      tournamentParticipants,
      eq(tournamentParticipants.tournamentId, tournaments.id),
    )
    .where(
      and(
        eq(tournamentParticipants.userId, userId),
        inArray(tournamentParticipants.status, [
          'pending',
          'confirmed',
          'invited',
        ]),
      ),
    )
    .orderBy(desc(tournaments.createdAt))
    .limit(limit);
}

/**
 * Update tournament status
 */
export async function updateTournamentStatus(
  tournamentId: UUID,
  status: TournamentStatus,
): Promise<void> {
  await db
    .update(tournaments)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));
}

/**
 * Close tournament registration and save confirmed participants count
 */
export async function closeRegistrationWithCount(
  tournamentId: UUID,
): Promise<number> {
  // Get participants count from tournamentParticipants table
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        eq(tournamentParticipants.status, 'confirmed'),
      ),
    );

  const count = result[0]?.count ?? 0;

  // Update tournament status and confirmed participants count atomically
  await db
    .update(tournaments)
    .set({
      status: 'registration_closed',
      confirmedParticipants: count,
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));

  return count;
}

/**
 * Delete tournament by ID
 */
export async function deleteTournament(tournamentId: UUID): Promise<void> {
  await db.delete(tournaments).where(eq(tournaments.id, tournamentId));
}

/**
 * Check if tournament can be deleted
 */
export function canDeleteTournament(status: string): boolean {
  return status === 'draft' || status === 'cancelled';
}

/**
 * Statuses from which a tournament may be cancelled: everything except a
 * tournament that is still a draft (delete it instead), already finished, or
 * already cancelled.
 */
export const CANCELLABLE_STATUSES: TournamentStatus[] = [
  'registration_open',
  'registration_closed',
  'in_progress',
];

/**
 * Check if tournament can be cancelled
 */
export function canCancelTournament(status: string): boolean {
  return (CANCELLABLE_STATUSES as string[]).includes(status);
}

/**
 * Cancel a tournament: flip its status to `cancelled` and mark every match that
 * has not yet finished as cancelled, so no further results can be reported. Runs
 * in a single transaction. Participant notification is the caller's job (the
 * service must not depend on the bot Api).
 */
export async function cancelTournament(tournamentId: UUID): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(tournaments)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(tournaments.id, tournamentId));

    await tx
      .update(matches)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(matches.tournamentId, tournamentId),
          notInArray(matches.status, ['completed', 'cancelled']),
        ),
      );
  });
}

/**
 * Legal forward transitions of the documented tournament state machine. A
 * status change is allowed only if the target is listed for the current status;
 * `completed`/`cancelled` are terminal. `in_progress`/`completed` are reachable
 * here but are set only via the dedicated start/auto-complete flows — the admin
 * `PATCH /status` route additionally blocks them as manual targets.
 */
export const TOURNAMENT_STATUS_TRANSITIONS: Record<
  TournamentStatus,
  TournamentStatus[]
> = {
  draft: ['registration_open', 'cancelled'],
  registration_open: ['registration_closed', 'cancelled'],
  registration_closed: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/**
 * Check whether a tournament may move from `from` to `to` per the documented
 * state machine.
 */
export function canTransitionTournamentStatus(
  from: TournamentStatus,
  to: TournamentStatus,
): boolean {
  return TOURNAMENT_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Statuses in which tournament settings may still be edited: before the bracket
 * is generated (which happens only at start), so no live structure can desync.
 */
export const EDITABLE_STATUSES: TournamentStatus[] = [
  'draft',
  'registration_open',
  'registration_closed',
];

/**
 * Check if tournament can be edited (only before it has started)
 */
export function canEditTournament(status: string): boolean {
  return (EDITABLE_STATUSES as string[]).includes(status);
}

/**
 * Confirm a participant (pending → confirmed).
 * Returns true if the row was updated (i.e. participant was in pending state).
 */
export async function confirmParticipant(
  tournamentId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .update(tournamentParticipants)
    .set({ status: 'confirmed' })
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId as UUID),
        eq(tournamentParticipants.userId, userId as UUID),
        eq(tournamentParticipants.status, 'pending'),
      ),
    )
    .returning({ userId: tournamentParticipants.userId });
  return result.length > 0;
}

/**
 * Delete a participant record entirely (confirmed → removed from tournament)
 */
export async function deleteParticipant(
  tournamentId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId as UUID),
        eq(tournamentParticipants.userId, userId as UUID),
      ),
    );
}

/**
 * Reject a participant (pending → cancelled).
 * Returns true if the row was updated (i.e. participant was in pending state).
 */
export async function rejectParticipant(
  tournamentId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .update(tournamentParticipants)
    .set({ status: 'cancelled', seed: null })
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId as UUID),
        eq(tournamentParticipants.userId, userId as UUID),
        eq(tournamentParticipants.status, 'pending'),
      ),
    )
    .returning({ userId: tournamentParticipants.userId });
  return result.length > 0;
}
