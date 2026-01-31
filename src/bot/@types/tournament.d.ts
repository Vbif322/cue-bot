import type { tournaments, tournamentStatus } from "../../db/schema.ts";

export type Status = (typeof tournaments.$inferSelect)["status"];
export type Tournament = typeof tournaments.$inferSelect;
