import { and, eq } from "drizzle-orm";
import { db } from "../db/db.js";
import { tournamentReferees } from "../db/schema.js";
import type { BotContext } from "./types.js";

export function isAdmin(ctx: BotContext): boolean {
  return ctx.dbUser.role === "admin";
}

export async function isTournamentReferee(
  ctx: BotContext,
  tournamentId: string
): Promise<boolean> {
  const referee = await db.query.tournamentReferees.findFirst({
    where: and(
      eq(tournamentReferees.tournamentId, tournamentId),
      eq(tournamentReferees.userId, ctx.dbUser.id)
    ),
  });

  return !!referee;
}

export async function canManageTournament(
  ctx: BotContext,
  tournamentId: string
): Promise<boolean> {
  if (isAdmin(ctx)) {
  }
  return isTournamentReferee(ctx, tournamentId);
}

export async function getUserRefereeTournaments(
  userId: string
): Promise<string[]> {
  const refs = await db.query.tournamentReferees.findMany({
    where: eq(tournamentReferees.userId, userId),
  });

  return refs.map((r) => r.tournamentId);
}
