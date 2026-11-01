import { beforeEach, describe, expect, it } from 'vitest';

import {
  activateGroupChat,
  bindGroupChat,
  deactivateGroupChat,
  getGroupChat,
  listActiveGroupChats,
  listGroupChatsForFederation,
  registerGroupChat,
  resolveAnnouncementTargets,
  unbindGroupChat,
} from '@/services/groupChatService.js';
import type { TournamentReadModel } from '@/bot/@types/tournament.js';

import {
  createFederation,
  createOrganizer,
  createTournament,
  createUser,
} from '../helpers/factories.js';
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
  it('только активные чаты, привязанные к федерации турнира', async () => {
    const fedA = await createFederation();
    const fedB = await createFederation();
    const tA = await createTournament({
      status: 'registration_open',
      federationId: fedA.id,
    });
    const tB = await createTournament({
      status: 'registration_open',
      federationId: fedB.id,
    });
    const platform = await createTournament({ status: 'registration_open' });

    for (const chatId of ['-10', '-11', '-12', '-13']) {
      await registerGroupChat({
        chatId,
        type: 'group',
        title: null,
        addedBy: null,
      });
    }
    await bindGroupChat('-11', fedA.id);
    await bindGroupChat('-12', fedB.id);
    await bindGroupChat('-13', fedA.id);
    await deactivateGroupChat('-13', 'command:stop_announcements');

    const ids = async (t: typeof tA) =>
      (await resolveAnnouncementTargets(t as unknown as TournamentReadModel))
        .map((c) => c.chatId)
        .sort();

    // Непривязанный '-10' не слышит ничего, погашенный '-13' — тоже.
    expect(await ids(tA)).toEqual(['-11']);
    expect(await ids(tB)).toEqual(['-12']);
    // Платформенный турнир в группы не уходит вовсе.
    expect(await ids(platform)).toEqual([]);

    await unbindGroupChat('-11');
    expect(await ids(tA)).toEqual([]);
  });

  it('повторная регистрация чата не сбрасывает привязку', async () => {
    const fed = await createFederation();
    await registerGroupChat({
      chatId: '-20',
      type: 'group',
      title: 'a',
      addedBy: null,
    });
    await bindGroupChat('-20', fed.id);
    await registerGroupChat({
      chatId: '-20',
      type: 'supergroup',
      title: 'b',
      addedBy: null,
    });
    expect((await getGroupChat('-20'))?.federationId).toBe(fed.id);
  });

  it('listGroupChatsForFederation: свои привязанные + непривязанные, добавленные командой', async () => {
    const fed = await createFederation();
    const other = await createFederation();
    const organizer = await createOrganizer(fed.id);
    const stranger = await createUser();
    await registerGroupChat({
      chatId: '-30',
      type: 'group',
      title: null,
      addedBy: organizer.id,
    });
    await registerGroupChat({
      chatId: '-31',
      type: 'group',
      title: null,
      addedBy: stranger.id,
    });
    await registerGroupChat({
      chatId: '-32',
      type: 'group',
      title: null,
      addedBy: null,
    });
    await registerGroupChat({
      chatId: '-33',
      type: 'group',
      title: null,
      addedBy: organizer.id,
    });
    await bindGroupChat('-32', fed.id);
    await bindGroupChat('-33', other.id); // добавил наш, но уже привязан к другой

    const list = await listGroupChatsForFederation(fed.id);
    expect(list.map((c) => c.chatId).sort()).toEqual(['-30', '-32']);
  });
});
