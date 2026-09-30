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
