import { GrammyError } from 'grammy';
import type { Api, InlineKeyboard } from 'grammy';
import { setTimeout as sleep } from 'node:timers/promises';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { groupAnnouncements } from '@/db/schema.js';
import {
  buildAnnouncementKeyboard,
  buildRegistrationOpenAnnouncement,
} from '@/bot/ui/groupAnnouncementUI.js';
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

    const text = buildRegistrationOpenAnnouncement({
      id: tournament.id,
      name: tournament.name,
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
    });
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
  } catch (error) {
    console.error('Рассылка анонса прервалась:', errorMessage(error));
  }

  return result;
}
