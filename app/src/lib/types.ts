// Frontend read-model types — модель по фактическим JSON-ответам роутов /api/app/*
// (даты сериализованы в строки).
//
// Enum-типы дублируем локально — как это делает @cue-bot/ui: app-слой
// презентационный и НЕ должен тянуть бэкенд-модели (у них поля-даты `Date` и
// alias `@/`, недоступный в проекте app). Значения держим в синхроне с
// prod-схемой вручную. Структурно совпадают с типами @cue-bot/ui, поэтому
// свободно передаются в StatusBadge-компоненты.
export type TournamentStatus =
  | 'draft'
  | 'registration_open'
  | 'registration_closed'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type TournamentFormat =
  | 'single_elimination'
  | 'double_elimination'
  | 'round_robin'
  | 'groups_playoff';

export type TournamentVisibility = 'public' | 'private';

export type TournamentScheduleMode = 'single_day' | 'per_match';

export type MatchStatus =
  | 'scheduled'
  | 'in_progress'
  | 'pending_confirmation'
  | 'completed'
  | 'cancelled';

/** Профиль игрока (services/userService.toAppUser). */
export interface AppUser {
  id: string;
  username: string;
  name: string | null;
  surname: string | null;
  email: string | null;
}

/** Статус участия (prod.tournament_participants.status). */
export type ParticipationStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'disqualified'
  | 'invited';

export type Discipline = 'snooker';

/** Турнир (TournamentReadModel, сериализованный). */
export interface AppTournament {
  id: string;
  venueId: string;
  name: string;
  description: string | null;
  discipline: Discipline;
  format: TournamentFormat;
  randomAdvancement: boolean;
  status: TournamentStatus;
  visibility: TournamentVisibility;
  scheduleMode: TournamentScheduleMode;
  startDate: string | null;
  confirmedParticipants: number | null;
  maxParticipants: number;
  winScore: number;
  mergeRound: number;
  groupsCount: number | null;
  participantsPerGroup: number | null;
  qualifiersPerGroup: number | null;
  groupDraw: string | null;
  rules: string | null;
  inviteCode: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  venueName: string | null;
  /** Живой счётчик участников со статусом confirmed. */
  confirmedCount: number;
  /** Живой счётчик участников со статусом pending. */
  pendingCount: number;
}

/** Участник турнира (только подтверждённые), GET /:id/participants. */
export interface AppParticipant {
  userId: string;
  username: string | null;
  name: string | null;
  seed: number | null;
}

/** Матч с присоединёнными полями игроков (MatchWithPlayers, сериализованный). */
export interface AppMatch {
  id: string;
  tournamentId: string;
  round: number;
  position: number;
  player1Id: string | null;
  player2Id: string | null;
  player1IsWalkover: boolean;
  player2IsWalkover: boolean;
  winnerId: string | null;
  player1Score: number | null;
  player2Score: number | null;
  status: MatchStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  reportedBy: string | null;
  confirmedBy: string | null;
  isTechnicalResult: boolean;
  technicalReason: string | null;
  isCorrected: boolean;
  correctionReason: string | null;
  nextMatchId: string | null;
  nextMatchPosition: string | null;
  bracketType: string | null;
  phase: 'group' | 'playoff';
  groupIndex: number | null;
  losersNextMatchPosition: number | null;
  losersNextMatchSlot: string | null;
  tableId: string | null;
  createdAt: string;
  updatedAt: string;
  player1Username?: string | null;
  player1Name?: string | null;
  player1Surname?: string | null;
  player2Username?: string | null;
  player2Name?: string | null;
  player2Surname?: string | null;
  winnerUsername?: string | null;
  winnerName?: string | null;
  winnerSurname?: string | null;
  tableName?: string | null;
}

/** Один сохранённый фрейм снукера (для разбивки по фреймам). */
export interface AppMatchFrame {
  frameNumber: number;
  player1Points: number;
  player2Points: number;
  player1Break: number | null;
  player2Break: number | null;
}

export interface PlayerStanding {
  userId: string;
  seed: number | null;
  played: number;
  wins: number;
  losses: number;
  framesWon: number;
  framesLost: number;
  frameDiff: number;
  rank: number;
}

export interface GroupStanding {
  groupIndex: number;
  rows: PlayerStanding[];
}

export interface BracketPlayer {
  username: string | null;
  name: string | null;
  surname: string | null;
  telegramId: string | null;
}

export interface MatchStats {
  total: number;
  completed: number;
  inProgress: number;
  scheduled: number;
}

/** GET /:id/bracket. */
export interface AppBracket {
  tournament: AppTournament;
  matches: AppMatch[];
  stats: MatchStats;
  totalRounds: number;
  standings: GroupStanding[];
  players: Record<string, BracketPlayer>;
}

/** GET /tournaments/:id. */
export interface TournamentDetail {
  tournament: AppTournament;
  isParticipant: boolean;
  isCreator: boolean;
  participationStatus: ParticipationStatus | null;
}

export type NotificationType =
  | 'registration_confirmed'
  | 'registration_rejected'
  | 'bracket_formed'
  | 'match_reminder'
  | 'result_confirmation_request'
  | 'result_confirmed'
  | 'tournament_results'
  | 'new_registration'
  | 'participant_limit_reached'
  | 'result_dispute'
  | 'match_result_pending'
  | 'disqualification'
  | 'tournament_invitation'
  | 'tournament_cancelled';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  tournamentId: string | null;
  matchId: string | null;
  isRead: boolean;
  isSent: boolean;
  sentAt: string | null;
  createdAt: string;
}

/** GET /api/app/me. */
export interface MeProfile extends AppUser {
  emailVerified: boolean;
  telegramLinked: boolean;
  /**
   * Присутствует, когда привязываемый Telegram уже занят другим аккаунтом и
   * доступно слияние текущего (email) аккаунта в него. Счётчики — история survivor'а.
   */
  pendingMerge?: {
    survivorTournaments: number;
    survivorMatches: number;
  };
}

export interface UserMatchStats {
  played: number;
  wins: number;
  losses: number;
}

export interface UserTournamentHistoryItem {
  id: string;
  name: string;
  completedAt: string;
  isWinner: boolean;
}

export interface MeStats {
  matches: UserMatchStats;
  tournamentHistory: UserTournamentHistoryItem[];
}

/** Результат register/join. */
export interface RegisterResult {
  status: 'pending' | 'confirmed';
}
