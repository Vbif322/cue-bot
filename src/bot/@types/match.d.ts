import type { matches } from "../../db/schema.ts";
import type { Serialize } from "./helpers.ts";

export type Match = typeof matches.$inferSelect;
export type MatchStatus = (typeof matches.$inferSelect)["status"];
export type BracketType = "winners" | "losers" | "grand_final";

/** Admin API match: serialized, joined player info, internal fields omitted */
export type ApiMatch = Omit<
  Serialize<Match>,
  | "updatedAt"
  | "reportedBy"
  | "confirmedBy"
  | "nextMatchId"
  | "nextMatchPosition"
  | "losersNextMatchPosition"
> & {
  bracketType: BracketType | null;
  player1Username: string | null;
  player1Name: string | null;
  player2Username: string | null;
  player2Name: string | null;
  winnerUsername: string | null;
};

export type ApiMatchStats = {
  total: number;
  completed: number;
  inProgress: number;
  scheduled: number;
};

/** Bot-facing match with joined player details */
export interface MatchWithPlayers extends Match {
  player1Username?: string | null;
  player1Name?: string | null;
  player1TelegramId?: string | null;
  player2Username?: string | null;
  player2Name?: string | null;
  player2TelegramId?: string | null;
  winnerUsername?: string | null;
  winnerName?: string | null;
  winnerTelegramId?: string | null;
}
