import type { users } from "../../db/schema.ts";

export type UserRole = (typeof users.$inferSelect)["role"];

/** DB row without birthday (not exposed via API) */
export type ApiUser = Omit<typeof users.$inferSelect, "birthday">;
