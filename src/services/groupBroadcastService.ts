import { and, eq, isNotNull } from 'drizzle-orm';
import { GrammyError } from 'grammy';
import type { Api, InlineKeyboard } from 'grammy';
import { setTimeout as sleep } from 'node:timers/promises';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { groupAnnouncements } from '@/db/schema.js';
import type { TournamentReadModel } from '@/bot/@types/tournament.js';
import {
  buildAnnouncementKeyboard,
  buildBracketKeyboard,
  buildRegistrationAnnouncement,
} from '@/bot/ui/groupAnnouncementUI.js';
import type {
  AnnouncementStatus,
  TournamentAnnouncement,
} from '@/bot/ui/groupAnnouncementUI.js';
import { markAnnouncementStale } from '@/services/announcementRefresh.js';
import type { RefreshOutcome } from '@/services/announcementRefresh.js';
import {
  deactivateGroupChat,
  registerGroupChat,
  resolveAnnouncementTargets,
} from '@/services/groupChatService.js';
import {
  getParticipantsCount,
  getTournament,
} from '@/services/tournamentService.js';
import { errorMessage } from '@/utils/errors.js';

/** Пауза между чатами: ≤20 msg/s при глобальном лимите Telegram ~30/s. */
const SEND_GAP_MS = 50;

export type PostOutcome =
  | { ok: true; messageId: number }
  | { ok: false; reason: 'unreachable'; detail: string }
  | { ok: false; reason: 'migrated'; newChatId: string }
  | { ok: false; reason: 'transient'; detail: string };

export type EditOutcome =
  | { ok: true }
  | { ok: false; reason: 'gone'; detail: string }
  | { ok: false; reason: 'rate_limited'; retryAfterSec: number }
  | { ok: false; reason: 'transient'; detail: string };

export interface AnnounceResult {
  sent: number;
  failed: number;
  skipped: number;
}

/** Ошибки 400, означающие «в этот чат писать больше нельзя». */
const UNREACHABLE_400 = [
  'chat not found',
  'group chat was deactivated',
  'not enough rights',
  'have no rights to send',
  'bot was kicked',
  'bot is not a member',
];

function classify(error: unknown): PostOutcome & { ok: false } {
  if (!(error instanceof GrammyError)) {
    return { ok: false, reason: 'transient', detail: errorMessage(error) };
  }

  if (error.error_code === 403) {
    return { ok: false, reason: 'unreachable', detail: error.description };
  }

  if (error.error_code === 400) {
    const migrateTo = error.parameters.migrate_to_chat_id;
    if (migrateTo !== undefined) {
      return { ok: false, reason: 'migrated', newChatId: String(migrateTo) };
    }

    const description = error.description.toLowerCase();
    if (UNREACHABLE_400.some((needle) => description.includes(needle))) {
      return { ok: false, reason: 'unreachable', detail: error.description };
    }
  }

  return { ok: false, reason: 'transient', detail: error.description };
}

/**
 * ШОВ ОТПРАВКИ В ГРУППУ (ROADMAP M7) — аналог `sendNotification`, но без записи
 * в `notifications` (там `userId` NOT NULL, под чат не годится).
 *
 * Никогда не бросает и НЕ ХОДИТ В БД: только отправляет и КЛАССИФИЦИРУЕТ сбой.
 * Решения (погасить чат, перерегистрировать) принимает вызывающий. Это не
 * стилистика, а необходимость: юнит-тесты не имеют доступа к БД, и запрос
 * отсюда завесил бы их на мёртвом DATABASE_URL.
 */
export async function postToGroupChat(
  api: Api,
  chatId: string,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<PostOutcome> {
  const replyMarkup = keyboard ? { reply_markup: keyboard } : {};

  try {
    const message = await api.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      ...replyMarkup,
    });
    return { ok: true, messageId: message.message_id };
  } catch (error) {
    // Legacy Markdown падает на одном кривом символе, и сбой этот веерный —
    // уронил бы анонс сразу во всех чатах. Билдер экранирует, но радиус
    // поражения оправдывает повтор простым текстом.
    if (
      error instanceof GrammyError &&
      error.error_code === 400 &&
      error.description.toLowerCase().includes("can't parse entities")
    ) {
      try {
        const message = await api.sendMessage(chatId, text, replyMarkup);
        return { ok: true, messageId: message.message_id };
      } catch (retryError) {
        return classify(retryError);
      }
    }

    return classify(error);
  }
}

/** Ошибки 400 правки, означающие «этого сообщения больше нет». */
const MESSAGE_GONE_400 = [
  'message to edit not found',
  "message can't be edited",
];

/** Если Telegram не скажет `retry_after`, ждём столько. */
const DEFAULT_RETRY_AFTER_SEC = 30;

function classifyEdit(error: unknown): EditOutcome & { ok: false } {
  if (error instanceof GrammyError) {
    if (error.error_code === 429) {
      return {
        ok: false,
        reason: 'rate_limited',
        retryAfterSec: error.parameters.retry_after ?? DEFAULT_RETRY_AFTER_SEC,
      };
    }

    const description = error.description.toLowerCase();
    if (
      error.error_code === 400 &&
      MESSAGE_GONE_400.some((needle) => description.includes(needle))
    ) {
      return { ok: false, reason: 'gone', detail: error.description };
    }
  }

  const outcome = classify(error);
  if (outcome.reason === 'transient') return outcome;
  // Чат недостижим или мигрировал: при миграции история переезжает с новыми
  // message_id, так что старое сообщение в любом случае не отредактировать.
  return {
    ok: false,
    reason: 'gone',
    detail: outcome.reason === 'migrated' ? 'migrated' : outcome.detail,
  };
}

function isNotModified(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    error.error_code === 400 &&
    error.description.toLowerCase().includes('message is not modified')
  );
}

/**
 * ШОВ ПРАВКИ АНОНСА — пара к `postToGroupChat`, по тем же правилам: никогда не
 * бросает, в БД не ходит, только правит и классифицирует сбой.
 *
 * Без `keyboard` кнопки снимаются явно (`inline_keyboard: []`): если просто не
 * передать `reply_markup`, Telegram оставит старую «Участвовать».
 *
 * Лимита по времени у правки нет: 48 часов в Bot API касаются только чужих
 * business-сообщений, свои сообщения в группе бот правит бессрочно.
 */
export async function editGroupMessage(
  api: Api,
  chatId: string,
  messageId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<EditOutcome> {
  const replyMarkup = { reply_markup: keyboard ?? { inline_keyboard: [] } };

  try {
    await api.editMessageText(chatId, messageId, text, {
      parse_mode: 'Markdown',
      ...replyMarkup,
    });
    return { ok: true };
  } catch (error) {
    // Счётчик не изменился (например, pending → confirmed) — это не сбой.
    if (isNotModified(error)) return { ok: true };

    // Тот же повтор простым текстом, что и в `postToGroupChat`.
    if (
      error instanceof GrammyError &&
      error.error_code === 400 &&
      error.description.toLowerCase().includes("can't parse entities")
    ) {
      try {
        await api.editMessageText(chatId, messageId, text, replyMarkup);
        return { ok: true };
      } catch (retryError) {
        if (isNotModified(retryError)) return { ok: true };
        return classifyEdit(retryError);
      }
    }

    return classifyEdit(error);
  }
}

/**
 * Поля анонса из турнира — общие для первой отправки и для правок. `null` для
 * черновика: анонса у него не бывает.
 */
function toAnnouncement(
  tournament: TournamentReadModel,
  participantsCount: number,
): TournamentAnnouncement | null {
  if (tournament.status === 'draft') return null;

  return {
    id: tournament.id,
    name: tournament.name,
    // Турнир с открытой регистрацией сделали приватным: группе в него больше не
    // записаться, поэтому для неё он выглядит закрытым.
    status:
      tournament.status === 'registration_open' &&
      tournament.visibility !== 'public'
        ? 'registration_closed'
        : tournament.status,
    sport: tournament.sport,
    discipline: tournament.discipline,
    format: tournament.format,
    randomAdvancement: tournament.randomAdvancement,
    venueName: tournament.venueName,
    startDate: tournament.startDate,
    maxParticipants: tournament.maxParticipants,
    participantsCount,
    winScore: tournament.winScore,
    description: tournament.description,
  };
}

/**
 * Кнопка под правленым анонсом: «Участвовать», пока идёт регистрация; ссылка
 * на сетку, когда турнир начался или завершён; иначе — без кнопки.
 */
async function announcementKeyboard(
  api: Api,
  tournament: TournamentReadModel,
  status: AnnouncementStatus,
): Promise<InlineKeyboard | undefined> {
  if (status === 'registration_open') {
    return buildAnnouncementKeyboard(
      tournament.id,
      (await api.getMe()).username,
    );
  }

  // Сетку приватного турнира гость на сайте не откроет.
  if (
    (status === 'in_progress' || status === 'completed') &&
    tournament.visibility === 'public'
  ) {
    return buildBracketKeyboard(tournament.id, tournament.format) ?? undefined;
  }

  return undefined;
}

/**
 * Пишем строку лога ПОСЛЕ успешной отправки. Конфликт по уникальному индексу
 * (чат, турнир, вид) означает, что анонс уже уходил — считаем пропуском.
 * Возвращает false, если строка уже была.
 */
async function logAnnouncement(
  chatId: string,
  tournamentId: UUID,
  messageId: number,
): Promise<boolean> {
  const inserted = await db
    .insert(groupAnnouncements)
    .values({
      chatId,
      tournamentId,
      kind: 'registration_open',
      messageId,
    })
    .onConflictDoNothing()
    .returning({ id: groupAnnouncements.id });

  return inserted.length > 0;
}

/** Был ли анонс по этой паре уже отправлен. */
async function alreadyAnnounced(
  chatId: string,
  tournamentId: UUID,
): Promise<boolean> {
  const existing = await db.query.groupAnnouncements.findFirst({
    where: (a, { and, eq }) =>
      and(
        eq(a.chatId, chatId),
        eq(a.tournamentId, tournamentId),
        eq(a.kind, 'registration_open'),
      ),
  });

  return existing !== undefined;
}

/**
 * Разослать анонс об открытии регистрации по подписанным групповым чатам.
 *
 * По контракту НЕ бросает: одна плохая группа не должна рвать рассылку, а у
 * вызывающего (бот-хендлер / админ-роут) всё равно нет пути восстановления.
 */
export async function announceRegistrationOpen(
  api: Api,
  tournamentId: UUID,
): Promise<AnnounceResult> {
  const result: AnnounceResult = { sent: 0, failed: 0, skipped: 0 };

  try {
    const tournament = await getTournament(tournamentId);
    if (!tournament) return result;

    // Видимость — это и есть модель подписки; проверка статуса делает
    // безопасным вызов не в том порядке.
    if (
      tournament.visibility !== 'public' ||
      tournament.status !== 'registration_open'
    ) {
      return result;
    }

    const chats = await resolveAnnouncementTargets(tournament);
    if (chats.length === 0) return result;

    const [participantsCount, me] = await Promise.all([
      getParticipantsCount(tournamentId),
      api.getMe(),
    ]);

    const announcement = toAnnouncement(tournament, participantsCount);
    if (!announcement) return result;

    const text = buildRegistrationAnnouncement(announcement);
    const keyboard = buildAnnouncementKeyboard(tournament.id, me.username);

    for (const [index, chat] of chats.entries()) {
      if (index > 0) await sleep(SEND_GAP_MS);

      if (await alreadyAnnounced(chat.chatId, tournamentId)) {
        result.skipped++;
        continue;
      }

      const outcome = await postToGroupChat(api, chat.chatId, text, keyboard);

      if (outcome.ok) {
        const logged = await logAnnouncement(
          chat.chatId,
          tournamentId,
          outcome.messageId,
        );
        if (logged) result.sent++;
        else result.skipped++;
        continue;
      }

      if (outcome.reason === 'unreachable') {
        await deactivateGroupChat(chat.chatId, outcome.detail.slice(0, 255));
        result.failed++;
        continue;
      }

      if (outcome.reason === 'migrated') {
        // Группа выросла в супергруппу. Лог на новый id намеренно НЕ переносим:
        // событие разовое, худший исход — один дубль. TODO M7.
        await registerGroupChat({
          chatId: outcome.newChatId,
          type: 'supergroup',
          title: chat.title,
          addedBy: chat.addedBy,
        });
        await deactivateGroupChat(chat.chatId, 'migrated');

        const retry = await postToGroupChat(
          api,
          outcome.newChatId,
          text,
          keyboard,
        );
        if (retry.ok) {
          await logAnnouncement(
            outcome.newChatId,
            tournamentId,
            retry.messageId,
          );
          result.sent++;
        } else {
          result.failed++;
        }
        continue;
      }

      console.error(
        `Не удалось отправить анонс в чат ${chat.chatId}:`,
        outcome.detail,
      );
      result.failed++;
    }

    // Кто-то мог записаться, пока шла рассылка: счётчик посчитан до неё, а
    // правка по сигналу тогда ещё не видела строк лога. Одна правка закрывает
    // это окно; если ничего не поменялось, Telegram ответит «not modified».
    if (result.sent > 0) markAnnouncementStale(tournamentId);
  } catch (error) {
    console.error('Рассылка анонса прервалась:', errorMessage(error));
  }

  return result;
}

/**
 * Перерисовать уже отправленные анонсы турнира: свежий счётчик участников,
 * заголовок по статусу, кнопка по статусу (см. `announcementKeyboard`).
 *
 * Зовётся из `announcementRefresh` по сигналу `markAnnouncementStale`. По
 * контракту не бросает. Чат при сбое НЕ гасит: это правка, а не рассылка, и
 * судьбу чата решает `announceRegistrationOpen`. Сообщение, которое больше не
 * отредактировать (удалили, бота выгнали, чат мигрировал), забываем —
 * обнуляем `messageId`, но строку оставляем: уникальный индекс по ней
 * защищает от повторной рассылки.
 */
export async function refreshRegistrationAnnouncement(
  api: Api,
  tournamentId: UUID,
): Promise<RefreshOutcome> {
  try {
    const rows = await db
      .select({
        id: groupAnnouncements.id,
        chatId: groupAnnouncements.chatId,
        messageId: groupAnnouncements.messageId,
      })
      .from(groupAnnouncements)
      .where(
        and(
          eq(groupAnnouncements.tournamentId, tournamentId),
          eq(groupAnnouncements.kind, 'registration_open'),
          isNotNull(groupAnnouncements.messageId),
        ),
      );
    if (rows.length === 0) return {};

    const tournament = await getTournament(tournamentId);
    if (!tournament) return {};

    const announcement = toAnnouncement(
      tournament,
      await getParticipantsCount(tournamentId),
    );
    if (!announcement) return {};

    const text = buildRegistrationAnnouncement(announcement);
    const keyboard = await announcementKeyboard(
      api,
      tournament,
      announcement.status,
    );

    for (const [index, row] of rows.entries()) {
      if (row.messageId === null) continue;
      if (index > 0) await sleep(SEND_GAP_MS);

      const outcome = await editGroupMessage(
        api,
        row.chatId,
        row.messageId,
        text,
        keyboard,
      );
      if (outcome.ok) continue;

      if (outcome.reason === 'rate_limited') {
        // Остальные чаты тоже перерисует повторный проход.
        return { retryAfterSec: outcome.retryAfterSec };
      }

      if (outcome.reason === 'gone') {
        await db
          .update(groupAnnouncements)
          .set({ messageId: null })
          .where(eq(groupAnnouncements.id, row.id));
        continue;
      }

      console.error(
        `Не удалось обновить анонс в чате ${row.chatId}:`,
        outcome.detail,
      );
    }
  } catch (error) {
    console.error('Обновление анонса прервалось:', errorMessage(error));
  }

  return {};
}
