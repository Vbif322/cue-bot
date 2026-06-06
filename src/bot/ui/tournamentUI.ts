import { InlineKeyboard } from 'grammy';
import { sql } from 'drizzle-orm';
import { and, eq, inArray } from 'drizzle-orm';
import type { UUID } from 'crypto';

import {
  DISCIPLINE_LABELS,
  formatFormat,
  STATUS_LABELS,
} from '@/utils/constants.js';
import { db } from '@/db/db.js';
import { tournamentParticipants } from '@/db/schema.js';
import type { ParticipantStatus } from '@/db/schema.js';
import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';
import { escapeMarkdown } from '@/utils/messageHelpers.js';

export type TournamentTab = 'current' | 'archive' | 'my';

export interface TournamentInfo {
  id: string;
  name: string;
  discipline: string;
  format: string;
  status: string;
  visibility: string;
  venueName: string | null;
  maxParticipants: number;
  startDate: Date | null;
  winScore: number;
  description: string | null;
  participantsCount: number;
  userParticipationStatus: 'pending' | 'confirmed' | null;
  /** Whether the current user has a pending invitation to this tournament. */
  isInvited: boolean;
}

/**
 * Get participants count for a tournament
 */
export async function getParticipantsCount(
  tournamentId: UUID,
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        inArray(tournamentParticipants.status, ['pending', 'confirmed']),
      ),
    );
  return result[0]?.count ?? 0;
}

/**
 * Get user's raw participation status for a tournament, including `invited`
 * (and `cancelled`/`disqualified`). Returns null if there is no participant
 * row. Used for access checks and the invitation UI.
 */
export async function getUserParticipationStatusAny(
  tournamentId: UUID,
  userId: UUID,
): Promise<ParticipantStatus | null> {
  const participation = await db.query.tournamentParticipants.findFirst({
    where: and(
      eq(tournamentParticipants.tournamentId, tournamentId),
      eq(tournamentParticipants.userId, userId),
    ),
  });

  return participation?.status ?? null;
}

/**
 * Get user's participation status for a tournament ("pending" | "confirmed" | null).
 * Drives the registration card text/buttons — intentionally narrower than
 * getUserParticipationStatusAny (no `invited`/`cancelled`).
 */
export async function getUserParticipationStatus(
  tournamentId: UUID,
  userId: UUID,
): Promise<'pending' | 'confirmed' | null> {
  const status = await getUserParticipationStatusAny(tournamentId, userId);

  return status === 'confirmed' || status === 'pending' ? status : null;
}

/**
 * Get full tournament info with participation status
 */
export async function getTournamentInfo(
  tournament: {
    id: UUID;
    name: string;
    discipline: string;
    format: string;
    status: string;
    visibility: string;
    venueName: string | null;
    maxParticipants: number;
    startDate: Date | null;
    winScore: number;
    description: string | null;
  },
  userId: UUID,
): Promise<TournamentInfo> {
  const [participantsCount, rawStatus] = await Promise.all([
    getParticipantsCount(tournament.id),
    getUserParticipationStatusAny(tournament.id, userId),
  ]);

  const userParticipationStatus =
    rawStatus === 'confirmed' || rawStatus === 'pending' ? rawStatus : null;

  return {
    ...tournament,
    participantsCount,
    userParticipationStatus,
    isInvited: rawStatus === 'invited',
  };
}

/**
 * Build tournament details message
 */
export function buildTournamentMessage(
  info: TournamentInfo,
  isAdmin: boolean,
): string {
  return (
    `📋 *${info.name}*\n\n` +
    (info.visibility === 'private' ? '🔒 Закрытый турнир\n' : '') +
    `Площадка: ${info.venueName ?? 'Не указана'}\n` +
    `Дисциплина: ${DISCIPLINE_LABELS[info.discipline] || info.discipline}\n` +
    `Формат: ${formatFormat(info.format)}\n` +
    `Статус: ${STATUS_LABELS[info.status as keyof typeof STATUS_LABELS] || info.status}\n` +
    `Участников: ${info.participantsCount}/${info.maxParticipants}\n` +
    `Дата: ${info.startDate ? DateTimeHelperInstance.formatDate(info.startDate) : 'Не указана'}\n` +
    `Игра до: ${info.winScore} побед\n` +
    (info.description ? `\nОписание: ${info.description}\n` : '') +
    (info.isInvited
      ? '\n📨 Вас пригласили в этот турнир'
      : info.userParticipationStatus === 'confirmed'
        ? '\n✅ Вы зарегистрированы'
        : info.userParticipationStatus === 'pending'
          ? '\n⏳ Ожидает подтверждения'
          : '') +
    (isAdmin ? `\n\nID: \`${info.id}\`` : '')
  );
}

/**
 * Build a compact tournament list item. The tournament name is carried by the
 * inline button (see buildTournamentTabsKeyboard), so the text stays short:
 * a single meta line with status, participants and (optional) date.
 *
 * The name is run through escapeMarkdown — it is free-form admin input and
 * could otherwise break the 'Markdown' parse_mode.
 */
export function buildTournamentListItemCompact(
  info: TournamentInfo,
  isAdmin: boolean,
): string {
  const status =
    STATUS_LABELS[info.status as keyof typeof STATUS_LABELS] || info.status;
  const date = info.startDate
    ? ` · ${DateTimeHelperInstance.formatDate(info.startDate)}`
    : '';
  const lock = info.visibility === 'private' ? '🔒 ' : '';

  return (
    `📋 *${lock}${escapeMarkdown(info.name)}*\n` +
    `   ${status} · ${info.participantsCount}/${info.maxParticipants}${date}\n` +
    (isAdmin ? `   ID: \`${info.id}\`\n` : '') +
    '\n'
  );
}

/**
 * Build keyboard for tournament details view
 */
export function buildTournamentKeyboard(
  info: TournamentInfo,
  isAdmin: boolean,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Pending invitation — accept/decline takes precedence over registration.
  if (info.isInvited) {
    keyboard
      .text('✅ Принять приглашение', `inv:accept:${info.id}`)
      .text('❌ Отклонить', `inv:decline:${info.id}`)
      .row();
  } else if (info.status === 'registration_open') {
    // User registration buttons
    if (!info.userParticipationStatus) {
      if (info.participantsCount < info.maxParticipants) {
        keyboard.text('Участвовать', `reg:join:${info.id}`).row();
      } else {
        keyboard.text('Мест нет', `reg:full:${info.id}`).row();
      }
    } else {
      keyboard.text('Отменить регистрацию', `reg:cancel:${info.id}`).row();
    }
  }

  // Bracket button — visible to everyone for in-progress and completed tournaments
  if (info.status === 'in_progress' || info.status === 'completed') {
    keyboard.text('📊 Сетка турнира', `bracket:view:${info.id}`).row();
  }

  // Admin buttons
  if (isAdmin) {
    if (info.status === 'draft') {
      keyboard
        .text('Открыть регистрацию', `tournament_open_reg:${info.id}`)
        .row();
      keyboard.text('Удалить', `tournament_delete:${info.id}`).row();
    }
    if (info.status === 'registration_open') {
      keyboard
        .text('Закрыть регистрацию', `tournament_close_reg:${info.id}`)
        .row();
      keyboard
        .text('👥 Управление участниками', `adm:pending_list:${info.id}`)
        .row();
    }
    if (info.status === 'registration_closed') {
      keyboard.text('🚀 Начать турнир', `tournament_start:${info.id}`).row();
      keyboard
        .text('👥 Управление участниками', `adm:pending_list:${info.id}`)
        .row();
    }

    // Invitations are how players reach a private tournament (it is hidden
    // from the public list). Offer them while the roster is still open.
    if (
      info.visibility === 'private' &&
      (info.status === 'draft' ||
        info.status === 'registration_open' ||
        info.status === 'registration_closed')
    ) {
      keyboard.text('👤 Пригласить игрока', `inv:add:${info.id}`).row();
      keyboard.text('🔗 Ссылка-приглашение', `inv:link:${info.id}`).row();
    }
  }

  keyboard.text('К списку турниров', 'menu:tournaments').row();

  return keyboard;
}

/**
 * Build keyboard for the tabbed tournament list: a row of filter tabs (active
 * one bracketed, since Telegram has no "selected button" state) followed by one
 * button per tournament that opens its card, regardless of status. The quick
 * «Участвовать» button is only added for `registration_open` tournaments.
 */
export function buildTournamentTabsKeyboard(
  activeTab: TournamentTab,
  tournaments: TournamentInfo[],
): InlineKeyboard {
  const mark = (label: string, tab: TournamentTab): string =>
    activeTab === tab ? `· ${label} ·` : label;

  const keyboard = new InlineKeyboard()
    .text(mark('Текущие', 'current'), 'tlist:current')
    .text(mark(' Завершённые', 'archive'), 'tlist:archive')
    .row()
    .text(mark('👤 Мои турниры', 'my'), 'tlist:my')
    .row();

  for (const t of tournaments) {
    const lock = t.visibility === 'private' ? '🔒 ' : '';
    keyboard.text(`📋 ${lock}${t.name}`, `tournament_info:${t.id}`);
    keyboard.row();
  }

  return keyboard;
}
