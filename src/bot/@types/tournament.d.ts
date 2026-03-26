import type { tournaments, tournamentParticipants } from '../../db/schema.ts';
import type { Serialize } from './helpers.ts';

export type TournamentStatus = (typeof tournaments.$inferSelect)['status'];
export type TournamentFormat = (typeof tournaments.$inferSelect)['format'];
export type Tournament = typeof tournaments.$inferSelect;
export type TournamentReadModel = Tournament & { venueName: string | null };

/** Serialized tournament row for JSON responses (timestamps → string), without updatedAt */
export type ApiTournament = Omit<Serialize<TournamentReadModel>, 'updatedAt'>;

/** Bot-facing participant (no status) */
export interface TournamentParticipant {
  userId: string;
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
