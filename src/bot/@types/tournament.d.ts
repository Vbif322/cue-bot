import type { UUID } from 'crypto';

import type { tournaments, tournamentParticipants } from '../../db/schema.js';

import type { Serialize } from './helpers.ts';

export type TournamentStatus = (typeof tournaments.$inferSelect)['status'];
export type TournamentFormat = (typeof tournaments.$inferSelect)['format'];
export type TournamentVisibility = (typeof tournaments.$inferSelect)['visibility'];
export type TournamentScheduleMode = (typeof tournaments.$inferSelect)['scheduleMode'];
export type Tournament = typeof tournaments.$inferSelect;
export type TournamentReadModel = Tournament & {
  venueName: string | null;
  /** Live count of participants with status 'confirmed' (not the stored snapshot). */
  confirmedCount: number;
  /** Live count of participants with status 'pending'. */
  pendingCount: number;
};

/** Serialized tournament row for JSON responses (timestamps → string), without updatedAt */
export type ApiTournament = Omit<Serialize<Tournament>, 'updatedAt'> & {
  venueName: string | null;
  confirmedCount: number;
  pendingCount: number;
};

/** Bot-facing participant (no status) */
export interface TournamentParticipant {
  userId: UUID;
  username: string | null;
  name: string | null;
  seed: number | null;
}

/** Admin API participant joined with user fields */
export type ApiTournamentParticipant = Pick<
  typeof tournamentParticipants.$inferSelect,
  'userId' | 'seed' | 'status'
> & {
  username: string | null;
  name: string | null;
};

/** One row of a groups_playoff group standing, enriched with player display info. */
export interface ApiPlayerStanding {
  userId: UUID;
  rank: number;
  played: number;
  wins: number;
  losses: number;
  framesWon: number;
  framesLost: number;
  frameDiff: number;
  username: string | null;
  name: string | null;
  /** Mathematically guaranteed a top-`qualifiersPerGroup` finish in the group. */
  clinched: boolean;
  /** Highest break across the player's group matches (snooker); null if none. */
  maxBreak: number | null;
}

export interface ApiGroupStanding {
  groupIndex: number;
  rows: ApiPlayerStanding[];
}
