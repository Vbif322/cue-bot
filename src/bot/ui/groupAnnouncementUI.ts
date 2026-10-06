import { InlineKeyboard } from 'grammy';

import type { TournamentStatus } from '@/bot/@types/tournament.js';
import {
  formatFormatWithMode,
  formatSportDiscipline,
} from '@/utils/constants.js';
import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';
import { escapeMarkdown } from '@/utils/messageHelpers.js';
import { publicSiteUrl } from '@/utils/publicUrl.js';

/** Максимум описания в анонсе — карточка в группе должна оставаться компактной. */
export const ANNOUNCEMENT_DESCRIPTION_LIMIT = 300;

/**
 * Статусы, в которых турнир может быть в анонсе. Без `draft`: анонс появляется
 * только при открытии регистрации, а в черновик оттуда не возвращаются.
 */
export type AnnouncementStatus = Exclude<TournamentStatus, 'draft'>;

/**
 * Данные для анонса. Намеренно НЕ `TournamentInfo`: та требует
 * `userParticipationStatus` / `isInvited`, а у группы нет «текущего
 * пользователя». Поля — плоские значения, чтобы билдер оставался чистым.
 */
export interface TournamentAnnouncement {
  id: string;
  name: string;
  status: AnnouncementStatus;
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
 * Заголовок карточки по статусу турнира. Анонс уходит при открытии регистрации,
 * а потом редактируется на месте — заголовок показывает, где турнир сейчас.
 */
const ANNOUNCEMENT_HEADERS: Record<AnnouncementStatus, string> = {
  registration_open: '🎱 *Открыта регистрация!*',
  registration_closed: '🔒 *Регистрация закрыта*',
  in_progress: '▶️ *Турнир начался*',
  completed: '🏁 *Турнир завершён*',
  cancelled: '❌ *Турнир отменён*',
};

/**
 * Текст анонса турнира для группового чата.
 *
 * Отправляется с `parse_mode: 'Markdown'`, поэтому `name`, `venueName` и
 * `description` (свободный ввод админа) проходят через `escapeMarkdown`.
 * Выводы `formatSportDiscipline` / `formatFormatWithMode` / `formatDate` берутся
 * из фиксированных таблиц и НЕ экранируются — иначе получилось бы двойное
 * экранирование.
 */
export function buildRegistrationAnnouncement(
  t: TournamentAnnouncement,
): string {
  const lines = [
    ANNOUNCEMENT_HEADERS[t.status],
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

  if (t.status === 'registration_open') {
    lines.push('', 'Регистрация - по кнопке ниже.');
  }

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

/** Форматы с сеткой; у остальных (круговая, группы) на той же странице таблица. */
const ELIMINATION_FORMATS = new Set([
  'single_elimination',
  'double_elimination',
]);

/**
 * Клавиатура анонса после старта — URL-кнопка на сетку на сайте игрока.
 *
 * Именно URL, а не `web_app`: Mini App-кнопки в групповых чатах недоступны.
 * Страница `/tournaments/:id/bracket` открыта и гостю, если турнир публичный —
 * за этим следит вызывающий. Подпись — как у ссылки на странице турнира.
 *
 * null, если ссылаться некуда (нет https PUBLIC_BASE_URL, обычный dev).
 */
export function buildBracketKeyboard(
  tournamentId: string,
  format: string,
): InlineKeyboard | null {
  const url = publicSiteUrl(`/tournaments/${tournamentId}/bracket`);
  if (url === null) return null;

  const label = ELIMINATION_FORMATS.has(format)
    ? '📊 Сетка турнира'
    : '📊 Таблица турнира';
  return new InlineKeyboard().url(label, url);
}
