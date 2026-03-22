import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { db } from "../db/db.js";
import {
  tournamentTables,
  tournaments,
  tournamentParticipants,
  tournamentFormat,
  users,
  venues,
  discipline,
} from "../db/schema.js";
import { shuffleArray } from "./bracketGenerator.js";
import { validateTableIdsForVenue } from "./tableService.js";
import type {
  TournamentStatus,
  TournamentParticipant,
  TournamentReadModel,
} from "../bot/@types/tournament.js";

export interface StartTournamentResult {
  canStart: boolean;
  error?: string;
  participantsCount: number;
}

export interface CreateTournamentDraftInput {
  name: string;
  description?: string | null;
  rules?: string | null;
  discipline: (typeof discipline)[number];
  format: (typeof tournamentFormat)[number];
  maxParticipants: number;
  winScore: number;
  startDate?: Date | null;
  venueId: string;
  tableIds?: string[];
  createdBy: string;
}

const tournamentReadColumns = {
  ...getTableColumns(tournaments),
  venueName: venues.name,
};

/**
 * Check if tournament can be started
 */
export async function canStartTournament(
  tournamentId: string,
): Promise<StartTournamentResult> {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    return { canStart: false, error: "Турнир не найден", participantsCount: 0 };
  }

  if (tournament.status !== "registration_closed") {
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
  tournamentId: string,
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
        inArray(tournamentParticipants.status, ["pending", "confirmed"]),
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
export async function startTournament(tournamentId: string): Promise<void> {
  // Get tournament to check format
  const tournament = await getTournament(tournamentId);
  if (!tournament) {
    throw new Error("Tournament not found");
  }

  // Validate double elimination requires exactly 16 participants
  if (tournament.format === "double_elimination") {
    const participants = await getConfirmedParticipants(tournamentId);
    if (participants.length < 8) {
      throw new Error(
        "Double elimination поддерживает не менее 8 участников. " +
          `Текущее количество: ${participants.length}`,
      );
    }
  }

  await db
    .update(tournaments)
    .set({
      status: "in_progress",
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));
}

export async function createTournamentDraft(
  input: CreateTournamentDraftInput,
): Promise<TournamentReadModel> {
  const venue = await db.query.venues.findFirst({
    where: eq(venues.id, input.venueId),
  });

  if (!venue) {
    throw new Error("Площадка не найдена");
  }

  const tableIds = input.tableIds ?? [];
  await validateTableIdsForVenue(tableIds, input.venueId);

  const created = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(tournaments)
      .values({
        name: input.name,
        description: input.description ?? null,
        rules: input.rules ?? null,
        discipline: input.discipline,
        format: input.format,
        maxParticipants: input.maxParticipants,
        winScore: input.winScore,
        startDate: input.startDate ?? null,
        venueId: input.venueId,
        createdBy: input.createdBy,
        status: "draft",
      })
      .returning({ id: tournaments.id });

    if (!inserted) {
      throw new Error("Ошибка создания турнира");
    }

    if (tableIds.length > 0) {
      await tx.insert(tournamentTables).values(
        tableIds.map((tableId, position) => ({
          tournamentId: inserted.id,
          tableId,
          position,
        })),
      );
    }

    return inserted;
  });

  const tournament = await getTournament(created.id);
  if (!tournament) {
    throw new Error("Ошибка загрузки турнира после создания");
  }

  return tournament;
}

/**
 * Complete tournament with winner
 */
export async function completeTournament(
  tournamentId: string,
  winnerId: string,
): Promise<void> {
  await db
    .update(tournaments)
    .set({
      status: "completed",
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));
}

/**
 * Get tournament by ID
 */
export async function getTournament(
  tournamentId: string,
): Promise<TournamentReadModel | null> {
  const rows = await db
    .select(tournamentReadColumns)
    .from(tournaments)
    .leftJoin(venues, eq(tournaments.venueId, venues.id))
    .where(eq(tournaments.id, tournamentId));

  return rows[0] ?? null;
}

/**
 * Assign random seeds to participants
 */
export async function assignRandomSeeds(tournamentId: string): Promise<void> {
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

  if (includesDrafts) {
    return db
      .select(tournamentReadColumns)
      .from(tournaments)
      .leftJoin(venues, eq(tournaments.venueId, venues.id))
      .orderBy(desc(tournaments.createdAt))
      .limit(limit);
  }

  return db
    .select(tournamentReadColumns)
    .from(tournaments)
    .leftJoin(venues, eq(tournaments.venueId, venues.id))
    .where(sql`${tournaments.status} <> 'draft'`)
    .orderBy(desc(tournaments.createdAt))
    .limit(limit);
}

/**
 * Update tournament status
 */
export async function updateTournamentStatus(
  tournamentId: string,
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
  tournamentId: string,
): Promise<number> {
  // Get participants count from tournamentParticipants table
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        inArray(tournamentParticipants.status, ["pending", "confirmed"]),
      ),
    );

  const count = result[0]?.count ?? 0;

  // Update tournament status and confirmed participants count atomically
  await db
    .update(tournaments)
    .set({
      status: "registration_closed",
      confirmedParticipants: count,
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));

  return count;
}

/**
 * Delete tournament by ID
 */
export async function deleteTournament(tournamentId: string): Promise<void> {
  await db.delete(tournaments).where(eq(tournaments.id, tournamentId));
}

/**
 * Check if tournament can be deleted
 */
export function canDeleteTournament(status: string): boolean {
  return status === "draft" || status === "cancelled";
}
