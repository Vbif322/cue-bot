import { InlineKeyboard } from "grammy";
import { sql } from "drizzle-orm";
import { db } from "../../db/db.js";
import { and, eq, inArray } from "drizzle-orm";
import { tournamentParticipants } from "../../db/schema.js";
import {
  DISCIPLINE_LABELS,
  FORMAT_LABELS,
  STATUS_LABELS,
} from "../../utils/constants.js";
import { formatDate } from "../../utils/dateHelpers.js";

export interface TournamentInfo {
  id: string;
  name: string;
  discipline: string;
  format: string;
  status: string;
  maxParticipants: number;
  startDate: Date | null;
  winScore: number;
  description: string | null;
  participantsCount: number;
  isUserRegistered: boolean;
}

/**
 * Get participants count for a tournament
 */
export async function getParticipantsCount(
  tournamentId: string,
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tournamentParticipants)
    .where(
      and(
        eq(tournamentParticipants.tournamentId, tournamentId),
        inArray(tournamentParticipants.status, ["pending", "confirmed"]),
      ),
    );
  return result[0]?.count ?? 0;
}

/**
 * Check if user is registered for tournament
 */
export async function isUserRegistered(
  tournamentId: string,
  userId: string,
): Promise<boolean> {
  const participation = await db.query.tournamentParticipants.findFirst({
    where: and(
      eq(tournamentParticipants.tournamentId, tournamentId),
      eq(tournamentParticipants.userId, userId),
    ),
  });

  return (
    !!participation &&
    (participation.status === "confirmed" || participation.status === "pending")
  );
}

/**
 * Get full tournament info with participation status
 */
export async function getTournamentInfo(
  tournament: {
    id: string;
    name: string;
    discipline: string;
    format: string;
    status: string;
    maxParticipants: number;
    startDate: Date | null;
    winScore: number;
    description: string | null;
  },
  userId: string,
): Promise<TournamentInfo> {
  const [participantsCount, isRegistered] = await Promise.all([
    getParticipantsCount(tournament.id),
    isUserRegistered(tournament.id, userId),
  ]);

  return {
    ...tournament,
    participantsCount,
    isUserRegistered: isRegistered,
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
    `Дисциплина: ${DISCIPLINE_LABELS[info.discipline] || info.discipline}\n` +
    `Формат: ${FORMAT_LABELS[info.format] || info.format}\n` +
    `Статус: ${STATUS_LABELS[info.status as keyof typeof STATUS_LABELS] || info.status}\n` +
    `Участников: ${info.participantsCount}/${info.maxParticipants}\n` +
    `Дата: ${info.startDate ? formatDate(info.startDate) : "Не указана"}\n` +
    `Игра до: ${info.winScore} побед\n` +
    (info.description ? `\nОписание: ${info.description}\n` : "") +
    (info.isUserRegistered ? "\n✅ Вы зарегистрированы" : "") +
    (isAdmin ? `\n\nID: \`${info.id}\`` : "")
  );
}

/**
 * Build tournament list item message
 */
export function buildTournamentListItem(
  info: TournamentInfo,
  isAdmin: boolean,
): string {
  return (
    `📋 *${info.name}*\n` +
    `   Дисциплина: ${DISCIPLINE_LABELS[info.discipline] || info.discipline}\n` +
    `   Формат: ${FORMAT_LABELS[info.format] || info.format}\n` +
    `   Статус: ${STATUS_LABELS[info.status as keyof typeof STATUS_LABELS] || info.status}\n` +
    `   Участников: ${info.participantsCount}/${info.maxParticipants}\n` +
    `   Дата: ${info.startDate ? formatDate(info.startDate) : "Не указана"}\n` +
    (isAdmin ? `   ID: \`${info.id}\`\n` : "") +
    "\n"
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

  // User registration buttons
  if (info.status === "registration_open") {
    if (!info.isUserRegistered) {
      if (info.participantsCount < info.maxParticipants) {
        keyboard.text("Участвовать", `reg:join:${info.id}`).row();
      } else {
        keyboard.text("Мест нет", `reg:full:${info.id}`).row();
      }
    } else {
      keyboard.text("Отменить регистрацию", `reg:cancel:${info.id}`).row();
    }
  }

  // Admin buttons
  if (isAdmin) {
    if (info.status === "draft") {
      keyboard
        .text("Открыть регистрацию", `tournament_open_reg:${info.id}`)
        .row();
      keyboard.text("Удалить", `tournament_delete:${info.id}`).row();
    }
    if (info.status === "registration_open") {
      keyboard
        .text("Закрыть регистрацию", `tournament_close_reg:${info.id}`)
        .row();
    }
    if (info.status === "registration_closed") {
      keyboard.text("🚀 Начать турнир", `tournament_start:${info.id}`).row();
    }
    if (info.status === "in_progress") {
      keyboard.text("📊 Сетка турнира", `bracket:view:${info.id}`).row();
    }
  }

  return keyboard;
}

/**
 * Build keyboard for tournament list (with registration buttons)
 */
export function buildTournamentListKeyboard(
  tournaments: TournamentInfo[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const t of tournaments) {
    if (t.status === "registration_open") {
      keyboard
        .text(`📋 ${t.name}`, `reg:view:${t.id}`)
        .text("Участвовать", `reg:join:${t.id}`)
        .row();
    }
  }

  return keyboard;
}

/**
 * Build keyboard for tournament selection
 */
export function buildTournamentSelectionKeyboard(
  tournaments: { id: string; name: string }[],
  callbackPrefix: string = "tournament_info",
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const t of tournaments) {
    keyboard.text(`📋 ${t.name}`, `${callbackPrefix}:${t.id}`).row();
  }
  return keyboard;
}
