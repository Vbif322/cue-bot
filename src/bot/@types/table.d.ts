import type { tables } from "../../db/schema.ts";
import type { Serialize } from "./helpers.ts";

export type Table = typeof tables.$inferSelect;
export type ApiTable = Omit<Serialize<Table>, never>;
