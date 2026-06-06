import { and, eq } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { tournamentParticipants, tournamentReferees } from '@/db/schema.js';
import type { ITournamentVisibility } from '@/db/schema.js';
import { isTournamentVisibleTo } from '@/services/tournamentService.js';

import type { BotContext } from './types.js';

export function isAdmin(ctx: BotContext): boolean {
  return ctx.dbUser.role === 'admin';
}

export async function isTournamentReferee(
  ctx: BotContext,
  tournamentId: UUID,
): Promise<boolean> {
  const referee = await db.query.tournamentReferees.findFirst({
    where: and(
      eq(tournamentReferees.tournamentId, tournamentId),
      eq(tournamentReferees.userId, ctx.dbUser.id),
    ),
  });

  return !!referee;
}

export async function canManageTournament(
  ctx: BotContext,
  tournamentId: UUID,
): Promise<boolean> {
  if (isAdmin(ctx)) {
    return true;
  }
  return isTournamentReferee(ctx, tournamentId);
}

/**
 * Whether the current user is allowed to view a tournament. Public tournaments
 * are visible to everyone; private (invite-only) ones only to admins, referees,
 * participants (incl. invited) and the creator. Used to hide private brackets/
 * cards from users who would otherwise reach them by a guessed id.
 */
export async function canViewTournament(
  ctx: BotContext,
  tournament: { id: UUID; visibility: ITournamentVisibility; createdBy: UUID },
): Promise<boolean> {
  if (tournament.visibility === 'public') return true;

  const isAdminViewer = isAdmin(ctx);
  const isCreator = tournament.createdBy === ctx.dbUser.id;

  // Cheap, no-DB checks short-circuit the participant/referee lookups.
  if (isAdminViewer || isCreator) return true;

  const [isReferee, participation] = await Promise.all([
    isTournamentReferee(ctx, tournament.id),
    db.query.tournamentParticipants.findFirst({
      where: and(
        eq(tournamentParticipants.tournamentId, tournament.id),
        eq(tournamentParticipants.userId, ctx.dbUser.id),
      ),
    }),
  ]);

  const isParticipant =
    participation != null &&
    participation.status !== 'cancelled' &&
    participation.status !== 'disqualified';

  return isTournamentVisibleTo(tournament, {
    isAdmin: isAdminViewer,
    isReferee,
    isParticipant,
    isCreator,
  });
}

export async function getUserRefereeTournaments(userId: UUID): Promise<UUID[]> {
  const refs = await db.query.tournamentReferees.findMany({
    where: eq(tournamentReferees.userId, userId),
  });

  return refs.map((r) => r.tournamentId);
}
