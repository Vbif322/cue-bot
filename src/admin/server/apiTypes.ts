// Re-exports from src/bot/@types/ — single source of truth for all shared types.
// Server routes and React client both import from here via @server/apiTypes.

export type {
  UserRole,
  ApiUser,
  ApiUserStats,
  ApiMaxBreakLeaderboardEntry,
} from '../../bot/@types/user.js';
export type {
  TournamentStatus,
  TournamentFormat,
  TournamentVisibility,
  TournamentScheduleMode,
  ApiTournament,
  ApiTournamentParticipant,
  ApiPlayerStanding,
  ApiGroupStanding,
  ApiPrizeRow,
  ApiPrizeReport,
} from '../../bot/@types/tournament.js';
export {
  formats,
  supportsRandomAdvancement,
  type ITournamentFormat,
} from '../../shared/tournament/formats.js';
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
  matchLengthStages,
  MATCH_LENGTH_STAGE_LABELS,
  validateStageWinScores,
  formatStageWinScores,
  type IMatchLengthStage,
  type IStageWinScores,
  type ITournamentMaxParticipants,
  type ITournamentWinScore,
  type ITournamentMergeRound,
  type IGroupDraw,
} from '../../shared/tournament/tournamentOptions.js';
export {
  prizeModes,
  PRIZE_MODE_LABELS,
  MAX_PRIZE_PLACES,
  PRIZE_PRESETS,
  expectedParticipants,
  prizeFundFor,
  organizerShareFor,
  validatePrizeDistribution,
  validateFinanceSettings,
  computePrizeDistribution,
  formatPlaceRange,
  formatRubles,
  type IPrizeMode,
  type IPrizePlace,
  type IPrizeDistribution,
  type IFinanceSettings,
  type IFundSettings,
  type IPrizeSummary,
} from '../../shared/tournament/prizes.js';
export type {
  MatchStatus,
  BracketType,
  ApiMatch,
  ApiMatchFrame,
  ApiMatchStats,
  ApiBusyElsewhere,
} from '../../bot/@types/match.js';
export type {
  ApiError,
  StartTournamentResponse,
} from '../../bot/@types/api.js';
export type { Table, ApiTable } from '../../bot/@types/table.js';
export type { Venue, ApiVenue } from '../../bot/@types/venue.js';
