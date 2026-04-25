import { and, asc, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import {
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
  startDate?: Date | null;
  maxParticipants: ITournamentMaxParticipants;
  winScore: ITournamentWinScore;
  rules?: string | null;
  createdBy: UUID;

  tableIds?: UUID[];
}

const tournamentReadColumns = {
  ...getTableColumns(tournaments),
  venueName: venues.name,
};

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
      error: `Недостаточно участников для запуска турнира (минимум 2, сейчас ${count})`,
      participantsCount: count,
    };
  }

  return { canStart: true, participantsCount: count };
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

  // Validate double elimination requires exactly 16 participants
  if (
    tournament.format === 'double_elimination' ||
    tournament.format === 'double_elimination_random'
  ) {
    const participants = await getConfirmedParticipants(tournamentId);
    if (participants.length < 8) {
      throw new Error(
        'Double elimination поддерживает не менее 8 участников. ' +
          `Текущее количество: ${participants.length}`,
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
        status: 'draft',
        startDate: input.startDate ?? null,
        maxParticipants: input.maxParticipants,
        winScore: input.winScore,
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
 * Assign random seeds to participants
 */
export async function assignRandomSeeds(tournamentId: UUID): Promise<void> {
  const participants = await getConfirmedParticipants(tournamentId);
  const shuffled = shuffleArray(participants);

  for (let i = 0; i < shuffled.length; i++) {
    const participant = shuffled[i];

    if (!participant) continue;

    await db
      .update(tournamentParticipants)
      .set({ seed: i + 1 })
      .where(
        and(
          eq(tournamentParticipants.tournamentId, tournamentId),
          eq(tournamentParticipants.userId, participant.userId),
        ),
      );
  }
}

/**
 * Get tournaments with optional filtering
 */
export async function getTournaments(options?: {
  limit?: number;
  includesDrafts?: boolean;
}): Promise<TournamentReadModel[]> {
  const { limit = 10, includesDrafts = true } = options || {};

  return db
    .select(tournamentReadColumns)
    .from(tournaments)
    .leftJoin(venues, eq(tournaments.venueId, venues.id))
    .where(includesDrafts ? undefined : sql`${tournaments.status} <> 'draft'`)
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
 * Confirm a participant (pending → confirmed).
 * Returns true if the row was updated (i.e. participant was in pending state).
 */
export async function confirmParticipant(
  tournamentId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .update(tournamentParticipants)
    .set({ status: "confirmed" })
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId as UUID),
        eq(tournamentParticipants.userId, userId as UUID),
        eq(tournamentParticipants.status, "pending"),
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
    .set({ status: "cancelled" })
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId as UUID),
        eq(tournamentParticipants.userId, userId as UUID),
        eq(tournamentParticipants.status, "pending"),
      ),
    )
    .returning({ userId: tournamentParticipants.userId });
  return result.length > 0;
}
