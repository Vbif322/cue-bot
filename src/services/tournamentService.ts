import { and, eq, inArray, asc, sql } from "drizzle-orm";
import { db } from "../db/db.js";
import { tournaments, tournamentParticipants, users } from "../db/schema.js";
import { shuffleArray } from "./bracketGenerator.js";
import type {
  TournamentStatus,
  TournamentParticipant,
} from "../bot/@types/tournament.js";

export interface StartTournamentResult {
  canStart: boolean;
  error?: string;
  participantsCount: number;
}

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
export async function getTournament(tournamentId: string) {
  return db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });
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
}) {
  const { limit = 10, includesDrafts = true } = options || {};

  return db.query.tournaments.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit,
    where: includesDrafts ? undefined : (t, { ne }) => ne(t.status, "draft"),
  });
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
