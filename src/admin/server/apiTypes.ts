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
  ApiPlayerStanding,
  ApiGroupStanding,
} from '../../bot/@types/tournament.js';
export { formats, type ITournamentFormat } from '../../shared/tournament/formats.js';
export {
  sports,
  disciplines,
  SPORT_DISCIPLINES,
  sportOfDiscipline,
  validateSportDiscipline,
  DEFAULT_WIN_SCORE_BY_DISCIPLINE,
  type ITournamentSport,
  type ITournamentDiscipline,
} from '../../shared/tournament/disciplines.js';
export {
  maxParticipants,
  winScores,
  mergeRounds,
  groupDraws,
  groupsCountOptions,
  participantsPerGroupOptions,
  validMergeRoundsForSize,
  validateGroupConfig,
  qualifiersOptionsForGroupSize,
  type ITournamentMaxParticipants,
  type ITournamentWinScore,
  type ITournamentMergeRound,
  type IGroupDraw,
} from '../../shared/tournament/tournamentOptions.js';
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
