import type { Api } from "grammy";
import {
  assignRandomSeeds,
  getConfirmedParticipants,
  startTournament,
  getTournament,
} from "./tournamentService.js";
import { generateBracket } from "./bracketGenerator.js";
import { createMatches, getRoundMatches, getMatch } from "./matchService.js";
import { notifyMatchAssigned } from "./notificationService.js";

export interface StartTournamentFullResult {
  participantsCount: number;
  matchesCreated: number;
  tournamentName: string;
}

/**
 * Full tournament start orchestration:
 * 1. Assign random seeds to participants
 * 2. Generate bracket
 * 3. Create matches in database
 * 4. Set tournament status to in_progress
 * 5. Notify first-round participants via Telegram
 */
export async function startTournamentFull(
  tournamentId: string,
  botApi: Api,
): Promise<StartTournamentFullResult> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error("Турнир не найден");

  // 1. Assign random seeds
  await assignRandomSeeds(tournamentId);

  // 2. Get participants with seeds
  const participants = await getConfirmedParticipants(tournamentId);

  // 3. Generate bracket
  const bracket = generateBracket(tournament.format, participants);

  // 4. Create matches in database
  await createMatches(tournamentId, bracket);

  // 5. Update tournament status to in_progress
  await startTournament(tournamentId);

  // 6. Notify first round participants (errors are non-fatal)
  const firstRoundMatches = await getRoundMatches(tournamentId, 1);
  for (const match of firstRoundMatches) {
    try {
      const matchWithPlayers = await getMatch(match.id);
      if (matchWithPlayers) {
        await notifyMatchAssigned(botApi, matchWithPlayers, tournament.name);
      }
    } catch (error) {
      console.error(
        `Failed to notify participants for match ${match.id}:`,
        error,
      );
    }
  }

  return {
    participantsCount: participants.length,
    matchesCreated: bracket.length,
    tournamentName: tournament.name,
  };
}
