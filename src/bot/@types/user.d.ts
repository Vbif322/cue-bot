import type { users } from '../../db/schema.ts';

export type UserRole = (typeof users.$inferSelect)['role'];

/** User row shape returned by the admin API (allow-listed via `toApiUser`). */
export type ApiUser = typeof users.$inferSelect;

/** Aggregated statistics for a single user, shown on the admin user page. */
export interface ApiUserStats {
  matches: {
    played: number;
    wins: number;
    losses: number;
    /** Frames (racks) from match scores; technical results excluded. */
    framesWon: number;
    framesLost: number;
    /** Snooker points from frame-by-frame reports; null when there are none. */
    points: { won: number; lost: number } | null;
    maxBreak: number | null;
  };
  tournamentHistory: {
    id: string;
    name: string;
    completedAt: string;
    isWinner: boolean;
  }[];
  refereeTournaments: { id: string; name: string; status: string }[];
}

/** One row of the max-break leaderboard (each player's best break of 20+). */
export interface ApiMaxBreakLeaderboardEntry {
  /** Competition rank: equal breaks share a place (1, 1, 3). */
  rank: number;
  userId: string;
  name: string | null;
  surname: string | null;
  username: string;
  maxBreak: number;
  /** When the match with the break was completed (ISO). */
  achievedAt: string | null;
  /** null on the player API when the tournament is private. */
  tournament: { id: string; name: string } | null;
}
