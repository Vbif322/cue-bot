import type { users } from '../../db/schema.ts';

export type UserRole = (typeof users.$inferSelect)['role'];

/** DB row without birthday (not exposed via API) */
export type ApiUser = Omit<typeof users.$inferSelect, 'birthday'>;

/** Aggregated statistics for a single user, shown on the admin user page. */
export interface ApiUserStats {
  matches: { played: number; wins: number; losses: number };
  tournamentHistory: {
    id: string;
    name: string;
    completedAt: string;
    isWinner: boolean;
  }[];
  refereeTournaments: { id: string; name: string; status: string }[];
}
