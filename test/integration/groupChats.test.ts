import { beforeEach, describe, expect, it } from 'vitest';

import {
  activateGroupChat,
  deactivateGroupChat,
  getGroupChat,
  listActiveGroupChats,
  registerGroupChat,
  resolveAnnouncementTargets,
} from '@/services/groupChatService.js';
import type { TournamentReadModel } from '@/bot/@types/tournament.js';

import { createTournament, createUser } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

beforeEach(truncateAll);

describe('registerGroupChat', () => {
  it('вставляет чат активным', async () => {
    await registerGroupChat({
      chatId: '-1001',
      type: 'supergroup',
      title: 'Клуб',
      addedBy: null,
    });

    const chat = await getGroupChat('-1001');
    expect(chat).toMatchObject({
      chatId: '-1001',
      type: 'supergroup',
      title: 'Клуб',
      isActive: true,
      addedBy: null,
    });
  });

  it('upsert по chat_id — одна строка, title обновляется', async () => {
    await registerGroupChat({
      chatId: '-1001',
      type: 'group',
      title: 'Старое',
      addedBy: null,
    });
    await registerGroupChat({
      chatId: '-1001',
      type: 'supergroup',
      title: 'Новое',
      addedBy: null,
    });

    const all = await listActiveGroupChats();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ title: 'Новое', type: 'supergroup' });
  });

  it('повторное добавление после кика возвращает подписку', async () => {
    await registerGroupChat({
      chatId: '-1001',
      type: 'group',
      title: 'Клуб',
      addedBy: null,
    });
    await deactivateGroupChat('-1001', 'my_chat_member:kicked');

    const kicked = await getGroupChat('-1001');
    expect(kicked?.isActive).toBe(false);
    expect(kicked?.deactivatedReason).toBe('my_chat_member:kicked');
    expect(kicked?.deactivatedAt).not.toBeNull();

    await registerGroupChat({
      chatId: '-1001',
      type: 'group',
      title: 'Клуб',
      addedBy: null,
    });

    const back = await getGroupChat('-1001');
    expect(back).toMatchObject({
      isActive: true,
      deactivatedAt: null,
      deactivatedReason: null,
    });
  });

  it('сохраняет добавившего пользователя', async () => {
    const user = await createUser();
    await registerGroupChat({
      chatId: '-1001',
      type: 'group',
      title: null,
      addedBy: user.id,
    });

    expect((await getGroupChat('-1001'))?.addedBy).toBe(user.id);
  });

  it('обрезает слишком длинную причину деактивации', async () => {
    await registerGroupChat({
      chatId: '-1001',
      type: 'group',
      title: null,
      addedBy: null,
    });
    await deactivateGroupChat('-1001', 'я'.repeat(400));

    expect((await getGroupChat('-1001'))?.deactivatedReason).toHaveLength(255);
  });
});

describe('listActiveGroupChats', () => {
  it('исключает погашенные чаты', async () => {
    for (const id of ['-1', '-2', '-3']) {
      await registerGroupChat({
        chatId: id,
        type: 'group',
        title: null,
        addedBy: null,
      });
    }
    await deactivateGroupChat('-2', 'command:stop_announcements');

    const active = (await listActiveGroupChats()).map((c) => c.chatId).sort();
    expect(active).toEqual(['-1', '-3']);
  });

  it('activateGroupChat возвращает чат в выборку', async () => {
    await registerGroupChat({
      chatId: '-1',
      type: 'group',
      title: null,
      addedBy: null,
    });
    await deactivateGroupChat('-1', 'command:stop_announcements');
    await activateGroupChat('-1');

    expect(await listActiveGroupChats()).toHaveLength(1);
  });
});

describe('resolveAnnouncementTargets', () => {
  it('сегодня — все активные чаты (одна неявная федерация)', async () => {
    const tournament = await createTournament({ status: 'registration_open' });

    await registerGroupChat({
      chatId: '-1',
      type: 'group',
      title: null,
      addedBy: null,
    });
    await registerGroupChat({
      chatId: '-2',
      type: 'group',
      title: null,
      addedBy: null,
    });
    await deactivateGroupChat('-2', 'command:stop_announcements');

    const targets = await resolveAnnouncementTargets(
      tournament as unknown as TournamentReadModel,
    );

    expect(targets.map((c) => c.chatId)).toEqual(['-1']);
  });
});
