import { and, eq } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { tournamentParticipants } from '@/db/schema.js';
import type { ITournamentVisibility } from '@/db/schema.js';
import { isTournamentVisibleTo } from '@/services/tournamentService.js';
import {
  canAdministerTournamentAsUser,
  canManageTournamentAsUser,
  canOrganizeAsUser,
} from '@/services/authz.js';
import { getMembership } from '@/services/federationService.js';
import {
  getUserRefereeTournamentIds,
  isTournamentRefereeUser,
} from '@/services/refereeService.js';

import type { BotContext } from './types.js';

/** Платформенный супер-админ (`users.role = 'admin'`). */
export function isAdmin(ctx: BotContext): boolean {
  return ctx.dbUser.role === 'admin';
}

/** Может организовывать турниры: админ или член хотя бы одной федерации. */
export async function canOrganize(ctx: BotContext): Promise<boolean> {
  return canOrganizeAsUser(ctx.dbUser);
}

export async function isTournamentReferee(
  ctx: BotContext,
  tournamentId: UUID,
): Promise<boolean> {
  return isTournamentRefereeUser(ctx.dbUser.id, tournamentId);
}

/**
 * Жизненный цикл турнира, участники, удаление, судьи: админ или член
 * федерации турнира. Судьи этого права НЕ имеют (см. `authz.ts`).
 */
export async function canAdministerTournament(
  ctx: BotContext,
  tournamentId: UUID,
): Promise<boolean> {
  return canAdministerTournamentAsUser(ctx.dbUser, tournamentId);
}

/** Матчи, инвайты, пульт: administer ∨ судья турнира. */
export async function canManageTournament(
  ctx: BotContext,
  tournamentId: UUID,
): Promise<boolean> {
  return canManageTournamentAsUser(ctx.dbUser, tournamentId);
}

/**
 * Whether the current user is allowed to view a tournament. Public and unlisted
 * tournaments are visible to everyone who has the link; private (invite-only)
 * ones only to admins, referees, participants (incl. invited), the creator and
 * the organizers of the tournament's federation. Used to hide private brackets/
 * cards from users who would otherwise reach them by a guessed id.
 */
export async function canViewTournament(
  ctx: BotContext,
  tournament: {
    id: UUID;
    visibility: ITournamentVisibility;
    createdBy: UUID;
    federationId: UUID | null;
  },
): Promise<boolean> {
  if (tournament.visibility !== 'private') return true;

  const isAdminViewer = isAdmin(ctx);
  const isCreator = tournament.createdBy === ctx.dbUser.id;

  // Cheap, no-DB checks short-circuit the participant/referee lookups.
  if (isAdminViewer || isCreator) return true;

  const [isReferee, participation, membership] = await Promise.all([
    isTournamentReferee(ctx, tournament.id),
    db.query.tournamentParticipants.findFirst({
      where: and(
        eq(tournamentParticipants.tournamentId, tournament.id),
        eq(tournamentParticipants.userId, ctx.dbUser.id),
      ),
    }),
    tournament.federationId === null
      ? Promise.resolve(null)
      : getMembership(ctx.dbUser.id, tournament.federationId),
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
    isOrganizer: membership !== null,
  });
}

export async function getUserRefereeTournaments(userId: UUID): Promise<UUID[]> {
  return getUserRefereeTournamentIds(userId);
}
