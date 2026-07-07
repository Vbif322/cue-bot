import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { UUID } from 'crypto';

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
export const idTournamentIdParam = z.object({ id: uuid(), tournamentId: uuid() });
export const tournamentIdParam = z.object({ tournamentId: uuid() });

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
