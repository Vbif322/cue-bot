import type { Context } from "grammy";
import type { users } from "../db/schema.js";

export type DbUser = typeof users.$inferSelect;

export interface BotContext extends Context {
  dbUser: DbUser;
}
