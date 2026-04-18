import type { UUID } from 'crypto';

import type { tournaments, tournamentParticipants } from '../../db/schema.js';

import type { Serialize } from './helpers.ts';

export type TournamentStatus = (typeof tournaments.$inferSelect)['status'];
export type TournamentFormat = (typeof tournaments.$inferSelect)['format'];
export type Tournament = typeof tournaments.$inferSelect;
export type TournamentReadModel = Tournament & { venueName: string | null };

/** Serialized tournament row for JSON responses (timestamps → string), without updatedAt */
export type ApiTournament = Omit<Serialize<Tournament>, 'updatedAt'> & {
  venueName: string | null;
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
