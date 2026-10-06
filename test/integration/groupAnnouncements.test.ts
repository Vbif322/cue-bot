import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrammyError } from 'grammy';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import { eq } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { groupAnnouncements, tournaments } from '@/db/schema.js';
import {
  announceRegistrationOpen,
  refreshRegistrationAnnouncement,
} from '@/services/groupBroadcastService.js';
import {
  getGroupChat,
  registerGroupChat,
  deactivateGroupChat,
} from '@/services/groupChatService.js';

import {
  createConfirmedParticipant,
  createTournament,
  createVenue,
} from '../helpers/factories.js';
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

describe('refreshRegistrationAnnouncement', () => {
  /** Турнир, уже анонсированный в чаты с указанными message_id. */
  async function announced(messages: Record<string, number | null>) {
    const tournament = await openTournament({ maxParticipants: 16 });
    for (const [chatId, messageId] of Object.entries(messages)) {
      await addChat(chatId);
      await db.insert(groupAnnouncements).values({
        chatId,
        tournamentId: tournament.id,
        kind: 'registration_open',
        messageId,
      });
    }
    return tournament;
  }

  function editCall(api: ReturnType<typeof createMockBotApi>, index = 0) {
    const call = api.editMessageText.mock.calls[index] as unknown[];
    return {
      chatId: call[0],
      messageId: call[1],
      text: call[2] as string,
      markup: (call[3] as { reply_markup: { inline_keyboard: unknown[][] } })
        .reply_markup,
    };
  }

  it('правит анонс свежим счётчиком и оставляет кнопку', async () => {
    const tournament = await announced({ '-101': 555 });
    await createConfirmedParticipant(tournament.id);
    await createConfirmedParticipant(tournament.id);

    const api = createMockBotApi();
    await expect(
      refreshRegistrationAnnouncement(api as unknown as Api, tournament.id),
    ).resolves.toEqual({});

    const edit = editCall(api);
    expect(edit).toMatchObject({ chatId: '-101', messageId: 555 });
    expect(edit.text).toContain('Открыта регистрация!');
    expect(edit.text).toContain('Участников: 2/16');
    expect(edit.markup.inline_keyboard).toHaveLength(1);
  });

  it('после закрытия регистрации — новый заголовок и без кнопки', async () => {
    const tournament = await announced({ '-101': 555 });
    await db
      .update(tournaments)
      .set({ status: 'registration_closed' })
      .where(eq(tournaments.id, tournament.id));

    const api = createMockBotApi();
    await refreshRegistrationAnnouncement(api as unknown as Api, tournament.id);

    const edit = editCall(api);
    expect(edit.text).toContain('Регистрация закрыта');
    expect(edit.markup.inline_keyboard).toEqual([]);
    expect(api.getMe).not.toHaveBeenCalled();
  });

  describe('после старта', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    async function started(overrides = {}) {
      const tournament = await announced({ '-101': 555 });
      await db
        .update(tournaments)
        .set({ status: 'in_progress', ...overrides })
        .where(eq(tournaments.id, tournament.id));
      return tournament;
    }

    it('кнопка на сетку вместо «Участвовать»', async () => {
      vi.stubEnv('PUBLIC_BASE_URL', 'https://cue.example');
      const tournament = await started();

      const api = createMockBotApi();
      await refreshRegistrationAnnouncement(
        api as unknown as Api,
        tournament.id,
      );

      const edit = editCall(api);
      expect(edit.text).toContain('Турнир начался');
      expect(edit.markup.inline_keyboard).toEqual([
        [
          {
            text: '📊 Сетка турнира',
            url: `https://cue.example/tournaments/${tournament.id}/bracket`,
          },
        ],
      ]);
    });

    it('приватный турнир — без кнопки на сетку', async () => {
      vi.stubEnv('PUBLIC_BASE_URL', 'https://cue.example');
      const tournament = await started({ visibility: 'private' });

      const api = createMockBotApi();
      await refreshRegistrationAnnouncement(
        api as unknown as Api,
        tournament.id,
      );

      expect(editCall(api).markup.inline_keyboard).toEqual([]);
    });

    it('без PUBLIC_BASE_URL — без кнопки', async () => {
      vi.stubEnv('PUBLIC_BASE_URL', '');
      const tournament = await started();

      const api = createMockBotApi();
      await refreshRegistrationAnnouncement(
        api as unknown as Api,
        tournament.id,
      );

      expect(editCall(api).markup.inline_keyboard).toEqual([]);
    });
  });

  it('турнир стал приватным — кнопка снимается', async () => {
    const tournament = await announced({ '-101': 555 });
    await db
      .update(tournaments)
      .set({ visibility: 'private' })
      .where(eq(tournaments.id, tournament.id));

    const api = createMockBotApi();
    await refreshRegistrationAnnouncement(api as unknown as Api, tournament.id);

    expect(editCall(api).markup.inline_keyboard).toEqual([]);
  });

  it('строки без message_id пропускает', async () => {
    const tournament = await announced({ '-101': null, '-102': 7 });

    const api = createMockBotApi();
    await refreshRegistrationAnnouncement(api as unknown as Api, tournament.id);

    expect(api.editMessageText).toHaveBeenCalledTimes(1);
    expect(editCall(api).chatId).toBe('-102');
  });

  it('удалённое сообщение забывается, строка лога остаётся', async () => {
    const tournament = await announced({ '-101': 555 });

    const api = createMockBotApi();
    api.editMessageText.mockRejectedValueOnce(
      apiError(400, 'Bad Request: message to edit not found'),
    );
    await refreshRegistrationAnnouncement(api as unknown as Api, tournament.id);

    const rows = await logRows(tournament.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.messageId).toBeNull();
    // Чат при этом не гасится — правка не решает судьбу чата.
    expect((await getGroupChat('-101'))?.isActive).toBe(true);

    api.editMessageText.mockClear();
    await refreshRegistrationAnnouncement(api as unknown as Api, tournament.id);
    expect(api.editMessageText).not.toHaveBeenCalled();
  });

  it('429 — останавливается и отдаёт retry_after', async () => {
    const tournament = await announced({ '-101': 1, '-102': 2 });

    const api = createMockBotApi();
    api.editMessageText.mockRejectedValueOnce(
      apiError(429, 'Too Many Requests: retry after 12', { retry_after: 12 }),
    );

    await expect(
      refreshRegistrationAnnouncement(api as unknown as Api, tournament.id),
    ).resolves.toEqual({ retryAfterSec: 12 });
    expect(api.editMessageText).toHaveBeenCalledTimes(1);
    expect((await logRows(tournament.id)).every((r) => r.messageId)).toBe(true);
  });

  it('нет анонсов — ни одного обращения к Telegram', async () => {
    const tournament = await openTournament();

    const api = createMockBotApi();
    await refreshRegistrationAnnouncement(api as unknown as Api, tournament.id);

    expect(api.editMessageText).not.toHaveBeenCalled();
    expect(api.getMe).not.toHaveBeenCalled();
  });
});
