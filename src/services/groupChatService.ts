import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { ChatMemberUpdated } from 'grammy/types';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { federationMembers, groupChats } from '@/db/schema.js';
import type { IGroupChat, IGroupChatType } from '@/db/schema.js';
import type { TournamentReadModel } from '@/bot/@types/tournament.js';

export interface GroupChatInput {
  chatId: string;
  type: IGroupChatType;
  title: string | null;
  addedBy: UUID | null;
}

/**
 * Upsert чата по `chat_id`. Всегда (ре)активирует и чистит следы деактивации:
 * повторное добавление бота в чат, откуда его выгоняли, должно возвращать
 * подписку, а не оставлять её выключенной.
 */
export async function registerGroupChat(input: GroupChatInput): Promise<void> {
  await db
    .insert(groupChats)
    .values({
      chatId: input.chatId,
      type: input.type,
      title: input.title,
      addedBy: input.addedBy,
    })
    .onConflictDoUpdate({
      target: groupChats.chatId,
      set: {
        type: input.type,
        title: input.title,
        addedBy: input.addedBy,
        isActive: true,
        deactivatedAt: null,
        deactivatedReason: null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Гасим подписку, не удаляя строку: сохраняем `added_by` и историю на случай
 * повторного добавления. `reason` — ops-хлебная крошка (`my_chat_member:kicked`,
 * `403: bot was kicked from the group chat`, …).
 */
export async function deactivateGroupChat(
  chatId: string,
  reason: string,
): Promise<void> {
  await db
    .update(groupChats)
    .set({
      isActive: false,
      deactivatedAt: new Date(),
      deactivatedReason: reason.slice(0, 255),
      updatedAt: new Date(),
    })
    .where(eq(groupChats.chatId, chatId));
}

export async function activateGroupChat(chatId: string): Promise<void> {
  await db
    .update(groupChats)
    .set({
      isActive: true,
      deactivatedAt: null,
      deactivatedReason: null,
      updatedAt: new Date(),
    })
    .where(eq(groupChats.chatId, chatId));
}

export async function getGroupChat(
  chatId: string,
): Promise<IGroupChat | undefined> {
  return db.query.groupChats.findFirst({
    where: eq(groupChats.chatId, chatId),
  });
}

export async function listActiveGroupChats(): Promise<IGroupChat[]> {
  return db.query.groupChats.findMany({
    where: eq(groupChats.isActive, true),
  });
}

/**
 * ШОВ МАРШРУТИЗАЦИИ: «какие чаты должны услышать про этот турнир».
 *
 * Анонс уходит только в чаты, привязанные к федерации турнира. Чат без
 * привязки (`federationId IS NULL`) не слышит ничего — бот в нём молчит, пока
 * чат не привяжут в панели. Платформенный турнир (без федерации) в группы не
 * анонсируется вовсе.
 *
 * Фильтр по `visibility`/`status` живёт в `announceRegistrationOpen`, а не
 * здесь: это свойство турнира, а не маршрутизации.
 */
export async function resolveAnnouncementTargets(
  tournament: TournamentReadModel,
): Promise<IGroupChat[]> {
  if (tournament.federationId === null) return [];

  return db.query.groupChats.findMany({
    where: and(
      eq(groupChats.isActive, true),
      eq(groupChats.federationId, tournament.federationId),
    ),
  });
}

/** Привязать чат к федерации: с этого момента он слышит только её турниры. */
export async function bindGroupChat(
  chatId: string,
  federationId: UUID,
): Promise<void> {
  await db
    .update(groupChats)
    .set({ federationId, updatedAt: new Date() })
    .where(eq(groupChats.chatId, chatId));
}

/** Снять привязку: чат перестаёт получать анонсы, бот в нём замолкает. */
export async function unbindGroupChat(chatId: string): Promise<void> {
  await db
    .update(groupChats)
    .set({ federationId: null, updatedAt: new Date() })
    .where(eq(groupChats.chatId, chatId));
}

/**
 * Чаты, которыми может распорядиться федерация: уже привязанные к ней, плюс
 * непривязанные, которые добавил кто-то из её команды (кандидаты на привязку).
 */
export async function listGroupChatsForFederation(
  federationId: UUID,
): Promise<IGroupChat[]> {
  const members = await db
    .select({ userId: federationMembers.userId })
    .from(federationMembers)
    .where(eq(federationMembers.federationId, federationId));
  const memberIds = members.map((m) => m.userId);
  return db.query.groupChats.findMany({
    where: or(
      eq(groupChats.federationId, federationId),
      memberIds.length > 0
        ? and(
            isNull(groupChats.federationId),
            inArray(groupChats.addedBy, memberIds),
          )
        : undefined,
    ),
  });
}

export type MyChatMemberAction =
  | { kind: 'join'; greet: boolean }
  | { kind: 'leave'; status: string }
  | { kind: 'ignore' };

/**
 * Чистый разбор `my_chat_member`: бот вошёл в чат, вышел, или это просто смена
 * прав. Вынесено из хендлера, чтобы покрыть юнит-тестом без БД — именно здесь
 * живут все краевые случаи.
 *
 * `greet` только при переходе из left/kicked: иначе бот переприветствовал бы
 * чат при каждом повышении/понижении в правах.
 *
 * `restricted` с `can_send_messages === false` — это фактический выход: писать
 * бот уже не может, держать подписку активной бессмысленно.
 */
export function classifyMyChatMember(
  update: ChatMemberUpdated,
): MyChatMemberAction {
  const from = update.old_chat_member.status;
  const to = update.new_chat_member;

  if (to.status === 'left' || to.status === 'kicked') {
    return { kind: 'leave', status: to.status };
  }

  if (to.status === 'restricted') {
    return to.can_send_messages
      ? { kind: 'ignore' }
      : { kind: 'leave', status: 'restricted' };
  }

  if (to.status === 'member' || to.status === 'administrator') {
    return { kind: 'join', greet: from === 'left' || from === 'kicked' };
  }

  return { kind: 'ignore' };
}
