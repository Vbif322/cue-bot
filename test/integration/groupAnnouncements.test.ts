import { beforeEach, describe, expect, it } from 'vitest';
import { GrammyError } from 'grammy';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { announceRegistrationOpen } from '@/services/groupBroadcastService.js';
import {
  getGroupChat,
  registerGroupChat,
  deactivateGroupChat,
} from '@/services/groupChatService.js';

import { createTournament, createVenue } from '../helpers/factories.js';
import { createMockBotApi } from '../helpers/mockBotApi.js';
import { truncateAll } from '../helpers/truncate.js';

beforeEach(truncateAll);

function apiError(
  error_code: number,
  description: string,
  parameters: Record<string, unknown> = {},
): GrammyError {
  return new GrammyError(
    `Call to 'sendMessage' failed! (${String(error_code)}: ${description})`,
    { ok: false, error_code, description, parameters },
    'sendMessage',
    {},
  );
}

async function openTournament(overrides = {}) {
  const venue = await createVenue();
  return createTournament({
    venueId: venue.id,
    status: 'registration_open',
    visibility: 'public',
    ...overrides,
  });
}

async function addChat(chatId: string): Promise<void> {
  await registerGroupChat({
    chatId,
    type: 'supergroup',
    title: `Чат ${chatId}`,
    addedBy: null,
  });
}

async function logRows(tournamentId: UUID) {
  return db.query.groupAnnouncements.findMany({
    where: (a, { eq }) => eq(a.tournamentId, tournamentId),
  });
}

describe('announceRegistrationOpen', () => {
  it('шлёт во все активные чаты и пропускает погашенные', async () => {
    const tournament = await openTournament();
    await addChat('-101');
    await addChat('-102');
    await addChat('-103');
    await deactivateGroupChat('-102', 'command:stop_announcements');

    const api = createMockBotApi();
    const result = await announceRegistrationOpen(
      api as unknown as Api,
      tournament.id,
    );

    expect(result).toEqual({ sent: 2, failed: 0, skipped: 0 });

    const targets = api.sendMessage.mock.calls
      .map((call) => call[0] as string)
      .sort();
    expect(targets).toEqual(['-101', '-103']);
  });

  it('в сообщении есть название и URL-кнопка с deep-link', async () => {
    const tournament = await openTournament({ name: 'Осенний кубок' });
    await addChat('-101');

    const api = createMockBotApi();
    await announceRegistrationOpen(api as unknown as Api, tournament.id);

    const call = api.sendMessage.mock.calls[0] as unknown[] | undefined;
    const text = call?.[1] as string;
    const options = call?.[2];
    expect(text).toContain('Осенний кубок');
    expect(text).toContain('Открыта регистрация!');

    const button = (
      options as { reply_markup: { inline_keyboard: { url?: string }[][] } }
    ).reply_markup.inline_keyboard[0]?.[0];
    expect(button?.url).toBe(`https://t.me/cue_bot?start=t_${tournament.id}`);
  });

  it('идемпотентность: второй вызов ничего не шлёт', async () => {
    const tournament = await openTournament();
    await addChat('-101');

    const api = createMockBotApi();
    const first = await announceRegistrationOpen(
      api as unknown as Api,
      tournament.id,
    );
    const second = await announceRegistrationOpen(
      api as unknown as Api,
      tournament.id,
    );

    expect(first).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(second).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(await logRows(tournament.id)).toHaveLength(1);
  });

  it('записывает message_id в лог', async () => {
    const tournament = await openTournament();
    await addChat('-101');

    const api = createMockBotApi();
    api.sendMessage.mockResolvedValue({ message_id: 555 });
    await announceRegistrationOpen(api as unknown as Api, tournament.id);

    expect((await logRows(tournament.id))[0]).toMatchObject({
      chatId: '-101',
      kind: 'registration_open',
      messageId: 555,
    });
  });

  it('приватный турнир не анонсируется', async () => {
    const tournament = await openTournament({ visibility: 'private' });
    await addChat('-101');

    const api = createMockBotApi();
    const result = await announceRegistrationOpen(
      api as unknown as Api,
      tournament.id,
    );

    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it.each(['draft', 'registration_closed', 'cancelled'] as const)(
    'турнир в статусе %s не анонсируется',
    async (status) => {
      const tournament = await openTournament({ status });
      await addChat('-101');

      const api = createMockBotApi();
      await announceRegistrationOpen(api as unknown as Api, tournament.id);

      expect(api.sendMessage).not.toHaveBeenCalled();
    },
  );

  it('403 гасит ТОЛЬКО проблемный чат, остальные получают анонс', async () => {
    const tournament = await openTournament();
    await addChat('-101');
    await addChat('-102');

    const api = createMockBotApi();
    api.sendMessage.mockImplementation((chatId: unknown) => {
      if (chatId === '-101') {
        throw apiError(
          403,
          'Forbidden: bot was kicked from the supergroup chat',
        );
      }
      return Promise.resolve({ message_id: 1 });
    });

    const result = await announceRegistrationOpen(
      api as unknown as Api,
      tournament.id,
    );

    expect(result).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect((await getGroupChat('-101'))?.isActive).toBe(false);
    expect((await getGroupChat('-102'))?.isActive).toBe(true);
  });

  it('миграция в супергруппу: регистрирует новый id и досылает', async () => {
    const tournament = await openTournament();
    await addChat('-500');

    const api = createMockBotApi();
    api.sendMessage.mockImplementation((chatId: unknown) => {
      if (chatId === '-500') {
        throw apiError(
          400,
          'Bad Request: group chat was upgraded to a supergroup chat',
          { migrate_to_chat_id: -1001234567890 },
        );
      }
      return Promise.resolve({ message_id: 2 });
    });

    const result = await announceRegistrationOpen(
      api as unknown as Api,
      tournament.id,
    );

    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect((await getGroupChat('-500'))?.isActive).toBe(false);
    expect(await getGroupChat('-1001234567890')).toMatchObject({
      isActive: true,
      type: 'supergroup',
    });
    expect((await logRows(tournament.id))[0]?.chatId).toBe('-1001234567890');
  });

  it('транзиентный сбой не гасит чат и не пишет лог', async () => {
    const tournament = await openTournament();
    await addChat('-101');

    const api = createMockBotApi();
    api.sendMessage.mockRejectedValue(new Error('socket hang up'));

    const result = await announceRegistrationOpen(
      api as unknown as Api,
      tournament.id,
    );

    expect(result).toEqual({ sent: 0, failed: 1, skipped: 0 });
    expect((await getGroupChat('-101'))?.isActive).toBe(true);
    expect(await logRows(tournament.id)).toHaveLength(0);
  });

  it('нет подписанных чатов — тихо и без обращений к Telegram', async () => {
    const tournament = await openTournament();

    const api = createMockBotApi();
    const result = await announceRegistrationOpen(
      api as unknown as Api,
      tournament.id,
    );

    expect(result).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(api.getMe).not.toHaveBeenCalled();
  });
});
