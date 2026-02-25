// Shared API types — plain interfaces, no framework deps.
// Both server routes and React client import from this file.

export type UserRole = "user" | "admin";
export type TournamentStatus =
  | "draft"
  | "registration_open"
  | "registration_closed"
  | "in_progress"
  | "completed"
  | "cancelled";
export type TournamentFormat =
  | "single_elimination"
  | "double_elimination"
  | "round_robin";
export type MatchStatus =
  | "scheduled"
  | "in_progress"
  | "pending_confirmation"
  | "completed"
  | "cancelled";
export type BracketType = "winners" | "losers" | "grand_final";

export interface ApiUser {
  id: string;
  telegramId: string;
  username: string;
  name: string | null;
  surname: string | null;
  phone: string | null;
  email: string | null;
  role: UserRole;
}

export interface ApiTournament {
  id: string;
  name: string;
  description: string | null;
  rules: string | null;
  format: TournamentFormat;
  status: TournamentStatus;
  discipline: string;
  startDate: string | null;
  maxParticipants: number;
  confirmedParticipants: number;
  winScore: number;
  createdAt: string;
  createdBy: string | null;
}

export interface ApiTournamentParticipant {
  userId: string;
  username: string | null;
  name: string | null;
  seed: number | null;
  status: string;
}

export interface ApiMatch {
  id: string;
  tournamentId: string;
  round: number;
  position: number;
  bracketType: BracketType | null;
  player1Id: string | null;
  player2Id: string | null;
  player1Username: string | null;
  player1Name: string | null;
  player2Username: string | null;
  player2Name: string | null;
  winnerId: string | null;
  winnerUsername: string | null;
  player1Score: number | null;
  player2Score: number | null;
  status: MatchStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  isTechnicalResult: boolean;
  technicalReason: string | null;
  createdAt: string;
}

export interface ApiMatchStats {
  total: number;
  completed: number;
  inProgress: number;
  scheduled: number;
}

export interface ApiError {
  error: string;
}

export interface StartTournamentResponse {
  participantsCount: number;
  matchesCreated: number;
  tournamentName: string;
}
