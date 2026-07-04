import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Общие хелперы для роутеров игрока (`/api/app/*`): единый конверт ошибок
 * валидации `{ error }` и маппинг outcome-объектов сервисов в HTTP-статусы.
 */

/** По полю → сообщение; иначе общий текст. */
type FieldMessages = Record<string, string>;

/**
 * `zValidator('json', …)` с единым конвертом: на невалидный ввод отдаёт
 * `400 { error: '<по-русски>' }` вместо сырого ZodError (утечка внутренних
 * regex + рассинхрон с `{data}`/`{error}`). Сообщение выбирается по имени
 * первого невалидного поля через `messages`, иначе — общий текст.
 */
export function validateJson<T extends z.ZodType>(
  schema: T,
  messages: FieldMessages = {},
) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      const field = String(result.error.issues[0]?.path[0] ?? '');
      const message = messages[field] ?? 'Некорректные данные запроса';
      return c.json({ error: message }, 400);
    }
  });
}

/**
 * `zValidator('param', …)` с тем же конвертом. Валидирует path-параметры
 * (в т.ч. UUID) — урок S2-8: невалидный id не должен доходить до Drizzle.
 */
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

/** Тот же конверт для query-параметров. */
export function validateQuery<T extends z.ZodType>(
  schema: T,
  message = 'Некорректные параметры запроса',
) {
  return zValidator('query', schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: message }, 400);
    }
  });
}

/**
 * Все `reason`-значения outcome-объектов tournamentService
 * (register/cancel/invite/accept/decline).
 */
export type OutcomeReason =
  | 'not_found'
  | 'not_registered'
  | 'not_invited'
  | 'tournament_started'
  | 'registration_closed'
  | 'already_registered'
  | 'already_participant'
  | 'full';

const REASON_STATUS: Record<OutcomeReason, ContentfulStatusCode> = {
  not_found: 404,
  not_registered: 404,
  not_invited: 409,
  tournament_started: 409,
  registration_closed: 409,
  already_registered: 409,
  already_participant: 409,
  full: 409,
};

const REASON_MESSAGE: Record<OutcomeReason, string> = {
  not_found: 'Турнир не найден',
  not_registered: 'Вы не зарегистрированы на этот турнир',
  not_invited: 'У вас нет приглашения на этот турнир',
  tournament_started: 'Турнир уже начался',
  registration_closed: 'Регистрация на турнир закрыта',
  already_registered: 'Вы уже зарегистрированы на этот турнир',
  already_participant: 'Вы уже участвуете в этом турнире',
  full: 'Достигнут лимит участников',
};

/** HTTP-статус для reason-а outcome-объекта. */
export function reasonToStatus(reason: OutcomeReason): ContentfulStatusCode {
  return REASON_STATUS[reason];
}

/** Русское сообщение для reason-а outcome-объекта. */
export function reasonToMessage(reason: OutcomeReason): string {
  return REASON_MESSAGE[reason];
}

/** Ответ на неуспешный outcome: `{ error }` с подходящим статусом. */
export function outcomeError(c: Context, reason: OutcomeReason) {
  return c.json({ error: reasonToMessage(reason) }, reasonToStatus(reason));
}
