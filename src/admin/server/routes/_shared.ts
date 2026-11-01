import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { z } from 'zod';
import type { UUID } from 'crypto';

import type { ActorScope, TournamentAccess } from '@/services/authz.js';
import {
  canAdministerTournamentWith,
  canManageTournamentWith,
} from '@/services/authz.js';
import { getMembership } from '@/services/federationService.js';
import { isTournamentRefereeUser } from '@/services/refereeService.js';
import { getTournament } from '@/services/tournamentService.js';
import type { TournamentReadModel } from '@/bot/@types/tournament.js';
import type { AdminUser } from '../middleware.js';

/**
 * Общие хелперы для admin-роутеров (`/api/admin/*`): валидация path-параметров
 * с единым конвертом ошибок `{ error }` (400). Урок S2-8: невалидный id не
 * должен доходить до Drizzle/Postgres и давать 500.
 *
 * Схемы отдают уже брендированный `UUID` (`z.uuid().transform`), поэтому
 * `c.req.valid('param')` типизирован как `{ id: UUID }` — каст `as UUID` на
 * месте чтения не нужен.
 */

const uuid = () => z.uuid().transform((v) => v as UUID);

export const idParam = z.object({ id: uuid() });
export const idUserIdParam = z.object({ id: uuid(), userId: uuid() });
export const idTournamentIdParam = z.object({
  id: uuid(),
  tournamentId: uuid(),
});
export const tournamentIdParam = z.object({ tournamentId: uuid() });
export const idFrameNumberParam = z.object({
  id: uuid(),
  frameNumber: z.coerce.number().int().min(1),
});

/** `zValidator('param', …)` с единым конвертом `{ error }` на невалидный параметр. */
export function validateParam<T extends z.ZodType>(
  schema: T,
  message = 'Некорректный идентификатор',
) {
  return zValidator('param', schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: message }, 400);
    }
  });
}

/**
 * Скоуп управления текущего актора панели (после `requireStaff`): платформенный
 * админ видит всё, организатор — только турниры/площадки своих федераций.
 * Передаётся в `getTournaments({ scope })` и подобные выборки.
 */
export function scopeOf(c: Context): ActorScope {
  const admin = c.get('adminUser');
  if (admin.isPlatformAdmin) return { kind: 'all' };
  return { kind: 'federations', ids: admin.federationIds };
}

export type ManageLevel = 'administer' | 'manage';

/**
 * Турнир для актора панели с проверкой прав: `administer` — жизненный цикл,
 * участники, удаление (админ ∨ член федерации); `manage` — матчи и чтение
 * (administer ∨ судья). Чужой или несуществующий турнир отдаёт одинаковый 404,
 * чтобы не раскрывать существование (как `loadVisible` в app-API).
 */
export async function loadManagedTournament(
  c: Context,
  id: UUID,
  level: ManageLevel,
): Promise<
  | { tournament: TournamentReadModel; error?: undefined }
  | { error: Response; tournament?: undefined }
> {
  const tournament = await getTournament(id);
  if (!tournament) return { error: c.json({ error: 'Не найден' }, 404) };
  const admin = c.get('adminUser');
  if (admin.isPlatformAdmin) return { tournament };

  const access: TournamentAccess = {
    membership:
      tournament.federationId === null
        ? null
        : (admin.federationRoles[tournament.federationId] ??
          (await getMembership(admin.id, tournament.federationId))),
    isReferee:
      level === 'manage'
        ? await isTournamentRefereeUser(admin.id, tournament.id)
        : false,
  };
  const allowed =
    level === 'administer'
      ? canAdministerTournamentWith(admin, access)
      : canManageTournamentWith(admin, access);
  if (!allowed) return { error: c.json({ error: 'Не найден' }, 404) };
  return { tournament };
}

/**
 * Hono-middleware для роутов `/:id…`: грузит турнир, проверяет уровень доступа
 * (GET → `manage`, остальное → `administer`) и кладёт его в `c.set('tournament')`.
 * Невалидный id пропускает дальше — его отвергнет `validateParam` (400).
 */
export function tournamentGuard(paramName = 'id') {
  return async (c: Context, next: () => Promise<void>) => {
    if (c.get('tournament') !== undefined) return next();
    const raw = c.req.param(paramName);
    if (!raw || !z.uuid().safeParse(raw).success) return next();
    const level: ManageLevel = c.req.method === 'GET' ? 'manage' : 'administer';
    const res = await loadManagedTournament(c, raw as UUID, level);
    if (res.error) return res.error;
    c.set('tournament', res.tournament);
    await next();
  };
}

/** Может ли актор редактировать/удалять площадку (общие — только админ). */
export function canEditVenue(
  admin: AdminUser,
  venue: { federationId: UUID | null },
): boolean {
  if (admin.isPlatformAdmin) return true;
  return (
    venue.federationId !== null &&
    admin.federationIds.includes(venue.federationId)
  );
}

/**
 * В какую федерацию писать ресурс (турнир, площадку). Платформенный админ —
 * любую или `null` (общий ресурс); организатор — только свою, иначе `undefined`
 * (вызывающий отвечает 403).
 */
export function resolveFederationForWrite(
  admin: AdminUser,
  requested: UUID | null,
): UUID | null | undefined {
  if (admin.isPlatformAdmin) return requested;
  if (requested !== null && admin.federationIds.includes(requested)) {
    return requested;
  }
  return undefined;
}

/**
 * Фильтр `?federationId=` для списков: `platform` → `null` (только для админа),
 * uuid → федерация (организатору — только своя). Невалидный/чужой → `error`.
 */
export function federationFilterFromQuery(c: Context): {
  federationId?: UUID | null;
  error?: Response;
} {
  const raw = c.req.query('federationId');
  if (raw === undefined || raw === '') return {};
  const admin = c.get('adminUser');
  if (raw === 'platform') {
    if (!admin.isPlatformAdmin) {
      return { error: c.json({ error: 'Недостаточно прав' }, 403) };
    }
    return { federationId: null };
  }
  if (!z.uuid().safeParse(raw).success) {
    return { error: c.json({ error: 'Некорректный federationId' }, 400) };
  }
  const id = raw as UUID;
  if (!admin.isPlatformAdmin && !admin.federationIds.includes(id)) {
    return { error: c.json({ error: 'Недостаточно прав' }, 403) };
  }
  return { federationId: id };
}
