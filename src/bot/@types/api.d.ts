export type ApiError = { error: string };

export type StartTournamentResponse = {
  participantsCount: number;
  matchesCreated: number;
  tournamentName: string;
};
