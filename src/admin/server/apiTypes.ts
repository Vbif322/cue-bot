// Re-exports from src/bot/@types/ — single source of truth for all shared types.
// Server routes and React client both import from here via @server/apiTypes.

export type { UserRole, ApiUser, ApiUserStats } from '../../bot/@types/user.js';
export type {
  TournamentStatus,
  TournamentFormat,
  TournamentVisibility,
  TournamentScheduleMode,
  ApiTournament,
  ApiTournamentParticipant,
} from '../../bot/@types/tournament.js';
export { formats, type ITournamentFormat } from './formats.js';
export {
  maxParticipants,
  winScores,
  type ITournamentMaxParticipants,
  type ITournamentWinScore,
} from './tournamentOptions.js';
export type {
  MatchStatus,
  BracketType,
  ApiMatch,
  ApiMatchStats,
} from '../../bot/@types/match.js';
export type {
  ApiError,
  StartTournamentResponse,
} from '../../bot/@types/api.js';
export type { Table, ApiTable } from '../../bot/@types/table.js';
export type { Venue, ApiVenue } from '../../bot/@types/venue.js';
