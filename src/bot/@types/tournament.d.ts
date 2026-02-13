import type { tournaments, tournamentStatus } from "../../db/schema.ts";

export type TournamentStatus = (typeof tournaments.$inferSelect)["status"];
export type Tournament = typeof tournaments.$inferSelect;
export interface TournamentParticipant {
  userId: string;
  username: string | null;
  name: string | null;
  seed: number | null;
}
