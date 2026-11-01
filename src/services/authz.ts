import { eq } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { tournaments } from '@/db/schema.js';
import type { IFederationRole, IUserRole } from '@/db/schema.js';

import {
  getFederationIdsOf,
  getMembership,
  isStaffUser,
} from './federationService.js';
import { isTournamentRefereeUser } from './refereeService.js';

/**
 * Единая модель прав (ROADMAP M8), общая для бота, админ-API и API игрока.
 *
 * Два уровня прав на турнир:
 * - **administer** — жизненный цикл, участники, удаление, судьи: платформенный
 *   админ или член федерации турнира (owner/organizer). У платформенного турнира
 *   (`federationId IS NULL`) администраторы — только глобальные админы.
 * - **manage** — матчи, инвайты, судейский пульт: administer ∨ судья турнира.
 *
 * Судья НЕ получает administer: до M8 он тоже не мог открывать регистрацию или
 * стартовать турнир, и расширять его права молча нельзя.
 *
 * Чистые предикаты (`*With`) не ходят в БД и покрыты unit-тестами; `*AsUser`
 * подгружают факты и делегируют им.
 */

export interface Actor {
  id: UUID;
  role: IUserRole;
}

/** Актор с полем платного права организатора (`users.organizerUntil`). */
export interface GrantedActor extends Actor {
  organizerUntil: Date | null;
}

/** Факты о связи актора с турниром, нужные предикатам. */
export interface TournamentAccess {
  /** Роль актора в федерации турнира; null — не член (или турнир платформенный). */
  membership: IFederationRole | null;
  isReferee: boolean;
}

/** Какие турниры/площадки видит актор в управлении. */
export type ActorScope = { kind: 'all' } | { kind: 'federations'; ids: UUID[] };

// ── Чистые предикаты ────────────────────────────────────────────────────────

export function isPlatformAdmin(actor: Actor): boolean {
  return actor.role === 'admin';
}

/**
 * Действует ли платное право организатора (`organizerUntil` в будущем). Его
 * выдаёт платформенный админ; без него нельзя создать свою организацию.
 */
export function hasOrganizerGrant(
  actor: Pick<GrantedActor, 'organizerUntil'>,
  now: Date = new Date(),
): boolean {
  return actor.organizerUntil !== null && actor.organizerUntil > now;
}

/** Создать свою организацию: админ или обладатель действующего права. */
export function canCreateFederationWith(
  actor: GrantedActor,
  now: Date = new Date(),
): boolean {
  return isPlatformAdmin(actor) || hasOrganizerGrant(actor, now);
}

/**
 * Вход в панель управления: админ, член хотя бы одной федерации (в т.ч. с
 * истёкшей подпиской — доиграть текущие турниры) или обладатель действующего
 * права, ещё не создавший организацию.
 */
export function isStaff(
  actor: GrantedActor,
  federationCount: number,
  now: Date = new Date(),
): boolean {
  return canCreateFederationWith(actor, now) || federationCount > 0;
}

/**
 * Открыты ли в федерации новые турниры: хотя бы у одного её владельца
 * действует право организатора. `activeUntil` — максимум `organizerUntil`
 * владельцев (null — ни у кого нет).
 */
export function isFederationActive(
  activeUntil: Date | null,
  now: Date = new Date(),
): boolean {
  return activeUntil !== null && activeUntil > now;
}

/** Настройки и состав федерации: админ или её owner. */
export function canManageFederation(
  actor: Actor,
  membership: IFederationRole | null,
): boolean {
  return isPlatformAdmin(actor) || membership === 'owner';
}

/** Создавать турниры в федерации: админ или любой её член. */
export function canOrganizeIn(
  actor: Actor,
  membership: IFederationRole | null,
): boolean {
  return isPlatformAdmin(actor) || membership !== null;
}

export function canAdministerTournamentWith(
  actor: Actor,
  access: TournamentAccess,
): boolean {
  return isPlatformAdmin(actor) || access.membership !== null;
}

export function canManageTournamentWith(
  actor: Actor,
  access: TournamentAccess,
): boolean {
  return canAdministerTournamentWith(actor, access) || access.isReferee;
}

/** Попадает ли турнир с таким `federationId` в скоуп актора. */
export function scopeIncludes(
  scope: ActorScope,
  federationId: UUID | null,
): boolean {
  if (scope.kind === 'all') return true;
  return federationId !== null && scope.ids.includes(federationId);
}

// ── Проверки с загрузкой фактов ─────────────────────────────────────────────

export async function getActorScope(actor: Actor): Promise<ActorScope> {
  if (isPlatformAdmin(actor)) return { kind: 'all' };
  return { kind: 'federations', ids: await getFederationIdsOf(actor.id) };
}

/**
 * Факты о связи актора с турниром. `null`, если турнира нет. Членство и
 * судейство грузятся параллельно; для платформенного турнира membership = null.
 */
export async function loadTournamentAccess(
  actor: Actor,
  tournamentId: UUID,
): Promise<TournamentAccess | null> {
  const [tournament] = await db
    .select({ federationId: tournaments.federationId })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!tournament) return null;

  const [membership, isReferee] = await Promise.all([
    tournament.federationId === null
      ? Promise.resolve(null)
      : getMembership(actor.id, tournament.federationId),
    isTournamentRefereeUser(actor.id, tournamentId),
  ]);
  return { membership, isReferee };
}

export async function canAdministerTournamentAsUser(
  actor: Actor,
  tournamentId: UUID,
): Promise<boolean> {
  if (isPlatformAdmin(actor)) return true;
  const access = await loadTournamentAccess(actor, tournamentId);
  return access !== null && canAdministerTournamentWith(actor, access);
}

/** Админ, член федерации турнира или его судья. */
export async function canManageTournamentAsUser(
  actor: Actor,
  tournamentId: UUID,
): Promise<boolean> {
  if (isPlatformAdmin(actor)) return true;
  const access = await loadTournamentAccess(actor, tournamentId);
  return access !== null && canManageTournamentWith(actor, access);
}

/** Может ли актор вообще что-то организовывать (= staff). */
export async function canOrganizeAsUser(actor: GrantedActor): Promise<boolean> {
  return isStaffUser(actor);
}
