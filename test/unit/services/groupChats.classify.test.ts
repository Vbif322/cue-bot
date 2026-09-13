import { describe, it, expect } from 'vitest';
import type { ChatMemberUpdated, ChatMember } from 'grammy/types';

import { classifyMyChatMember } from '@/services/groupChatService.js';

/** Минимальный `my_chat_member` с нужной парой статусов. */
function update(
  oldStatus: ChatMember['status'],
  newMember: Partial<ChatMember> & { status: ChatMember['status'] },
): ChatMemberUpdated {
  const user = { id: 42, is_bot: true, first_name: 'Bot' };

  return {
    chat: { id: -1001, type: 'supergroup', title: 'Клуб' },
    from: { id: 7, is_bot: false, first_name: 'Админ' },
    date: 0,
    old_chat_member: { status: oldStatus, user },
    new_chat_member: { ...newMember, user },
  } as unknown as ChatMemberUpdated;
}

describe('classifyMyChatMember', () => {
  it('бота добавили в чат — join с приветствием', () => {
    expect(classifyMyChatMember(update('left', { status: 'member' }))).toEqual({
      kind: 'join',
      greet: true,
    });
  });

  it('бота вернули после кика — join с приветствием', () => {
    expect(
      classifyMyChatMember(update('kicked', { status: 'member' })),
    ).toEqual({ kind: 'join', greet: true });
  });

  it('боту выдали админку — join, но БЕЗ повторного приветствия', () => {
    expect(
      classifyMyChatMember(update('member', { status: 'administrator' })),
    ).toEqual({ kind: 'join', greet: false });
  });

  it('у бота забрали админку — join, без приветствия', () => {
    expect(
      classifyMyChatMember(update('administrator', { status: 'member' })),
    ).toEqual({ kind: 'join', greet: false });
  });

  it('бота выгнали — leave', () => {
    expect(
      classifyMyChatMember(update('member', { status: 'kicked' })),
    ).toEqual({ kind: 'leave', status: 'kicked' });
  });

  it('бот покинул чат — leave', () => {
    expect(classifyMyChatMember(update('member', { status: 'left' }))).toEqual({
      kind: 'leave',
      status: 'left',
    });
  });

  it('боту запретили писать — leave (подписку держать бессмысленно)', () => {
    expect(
      classifyMyChatMember(
        update('member', { status: 'restricted', can_send_messages: false }),
      ),
    ).toEqual({ kind: 'leave', status: 'restricted' });
  });

  it('ограничен, но писать может — ignore', () => {
    expect(
      classifyMyChatMember(
        update('member', { status: 'restricted', can_send_messages: true }),
      ),
    ).toEqual({ kind: 'ignore' });
  });
});
