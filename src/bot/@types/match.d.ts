import type { matches } from "../../db/schema.ts";

export type Match = typeof matches.$inferSelect;

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
