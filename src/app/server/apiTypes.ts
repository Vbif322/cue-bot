// Re-exports from src/bot/@types/ — single source of truth for player-facing
// read-model types. The future player SPA (Этап 5) imports from here via its
// own alias; the admin `@server` alias (→ src/admin/server) is untouched.

export type { UserRole, ApiUser, ApiUserStats } from '../../bot/@types/user.js';
export type { AppUser } from '../../services/userService.js';
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
export type {
  MatchStatus,
  BracketType,
  ApiMatch,
  ApiMatchStats,
} from '../../bot/@types/match.js';
export type { ApiNotification } from '../../bot/@types/notification.js';
export type { ApiError } from '../../bot/@types/api.js';
