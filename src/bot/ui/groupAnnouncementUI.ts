import { InlineKeyboard } from 'grammy';

import {
  formatFormatWithMode,
  formatSportDiscipline,
} from '@/utils/constants.js';
import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';
import { escapeMarkdown } from '@/utils/messageHelpers.js';

/** Максимум описания в анонсе — карточка в группе должна оставаться компактной. */
export const ANNOUNCEMENT_DESCRIPTION_LIMIT = 300;

/**
 * Данные для анонса. Намеренно НЕ `TournamentInfo`: та требует
 * `userParticipationStatus` / `isInvited`, а у группы нет «текущего
 * пользователя». Поля — плоские значения, чтобы билдер оставался чистым.
 */
export interface TournamentAnnouncement {
  id: string;
  name: string;
  sport: string;
  discipline: string;
  format: string;
  randomAdvancement: boolean;
  venueName: string | null;
  startDate: Date | null;
  maxParticipants: number;
  participantsCount: number;
  winScore: number;
  description: string | null;
}

/**
 * Текст анонса об открытии регистрации для группового чата.
 *
 * Отправляется с `parse_mode: 'Markdown'`, поэтому `name`, `venueName` и
 * `description` (свободный ввод админа) проходят через `escapeMarkdown`.
 * Выводы `formatSportDiscipline` / `formatFormatWithMode` / `formatDate` берутся
 * из фиксированных таблиц и НЕ экранируются — иначе получилось бы двойное
 * экранирование.
 */
export function buildRegistrationOpenAnnouncement(
  t: TournamentAnnouncement,
): string {
  const lines = [
    '🎱 *Открыта регистрация!*',
    '',
    `*${escapeMarkdown(t.name)}*`,
    `Площадка: ${t.venueName === null ? 'Не указана' : escapeMarkdown(t.venueName)}`,
    `Дисциплина: ${formatSportDiscipline(t.sport, t.discipline)}`,
    `Формат: ${formatFormatWithMode(t.format, t.randomAdvancement)}`,
    `Дата: ${t.startDate ? DateTimeHelperInstance.formatDate(t.startDate) : 'Не указана'}`,
    `Игра до: ${String(t.winScore)} побед`,
    `Участников: ${String(t.participantsCount)}/${String(t.maxParticipants)}`,
  ];

  const description = t.description?.trim();
  if (description !== undefined && description.length > 0) {
    // Режем ДО экранирования: срез после мог бы оставить висящий '\'.
    lines.push(
      '',
      escapeMarkdown(description.slice(0, ANNOUNCEMENT_DESCRIPTION_LIMIT)),
    );
  }

  lines.push('', 'Регистрация - по кнопке ниже.');

  return lines.join('\n');
}

/**
 * Клавиатура анонса — одна URL-кнопка в личку бота.
 *
 * Именно URL, а не callback: регистрация должна происходить в приватном чате,
 * где бот уже умеет всё остальное (подтверждение админом, уведомления по
 * матчам) и где ему точно разрешено писать пользователю.
 *
 * `botUsername` приходит параметром, а не из `ctx.me` — это и делает функцию
 * чистой и юнит-тестируемой. Payload `t_<uuid>` = 38 символов при лимите 64.
 */
export function buildAnnouncementKeyboard(
  tournamentId: string,
  botUsername: string,
): InlineKeyboard {
  return new InlineKeyboard().url(
    'Участвовать',
    `https://t.me/${botUsername}?start=t_${tournamentId}`,
  );
}
