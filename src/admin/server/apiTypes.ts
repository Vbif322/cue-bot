// Re-exports from src/bot/@types/ — single source of truth for all shared types.
// Server routes and React client both import from here via @server/apiTypes.

export type { UserRole, ApiUser } from "../../bot/@types/user.js";
export type {
  TournamentStatus,
  TournamentFormat,
  ApiTournament,
  ApiTournamentParticipant,
} from "../../bot/@types/tournament.js";
export type {
  MatchStatus,
  BracketType,
  ApiMatch,
  ApiMatchStats,
} from "../../bot/@types/match.js";
export type { ApiError, StartTournamentResponse } from "../../bot/@types/api.js";
