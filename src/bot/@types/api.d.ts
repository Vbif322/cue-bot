export interface ApiError { error: string }

export interface StartTournamentResponse {
  participantsCount: number;
  matchesCreated: number;
  tournamentName: string;
}
