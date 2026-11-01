import { describe, it, expect, vi } from 'vitest';
import { GrammyError, InlineKeyboard } from 'grammy';
import type { Api } from 'grammy';

import {
  editGroupMessage,
  postToGroupChat,
} from '@/services/groupBroadcastService.js';

/** GrammyError с нужным кодом/описанием, как его строит grammY из ответа API. */
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

function apiThatThrows(...errors: unknown[]) {
  const sendMessage = vi.fn();
  for (const error of errors) sendMessage.mockRejectedValueOnce(error);
  return { api: { sendMessage } as unknown as Api, sendMessage };
}

describe('postToGroupChat', () => {
  it('возвращает messageId при успехе', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 77 });
    const api = { sendMessage } as unknown as Api;

    const outcome = await postToGroupChat(api, '-100500', 'текст');

    expect(outcome).toEqual({ ok: true, messageId: 77 });
    expect(sendMessage).toHaveBeenCalledWith('-100500', 'текст', {
      parse_mode: 'Markdown',
    });
  });

  it('прикладывает клавиатуру, когда она передана', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const keyboard = new InlineKeyboard().url('Участвовать', 'https://t.me/b');

    await postToGroupChat(
      { sendMessage } as unknown as Api,
      '-1',
      'текст',
      keyboard,
    );

    expect(sendMessage).toHaveBeenCalledWith('-1', 'текст', {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  it('403 — чат недостижим', async () => {
    const { api } = apiThatThrows(
      apiError(403, 'Forbidden: bot was kicked from the supergroup chat'),
    );

    await expect(postToGroupChat(api, '-1', 'т')).resolves.toMatchObject({
      ok: false,
      reason: 'unreachable',
    });
  });

  it.each([
    'Bad Request: chat not found',
    'Bad Request: have no rights to send a message',
    'Bad Request: not enough rights to send text messages to the chat',
  ])('400 «%s» — чат недостижим', async (description) => {
    const { api } = apiThatThrows(apiError(400, description));

    await expect(postToGroupChat(api, '-1', 'т')).resolves.toMatchObject({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('400 с migrate_to_chat_id — сообщает новый id чата', async () => {
    const { api } = apiThatThrows(
      apiError(
        400,
        'Bad Request: group chat was upgraded to a supergroup chat',
        {
          migrate_to_chat_id: -1001234567890,
        },
      ),
    );

    await expect(postToGroupChat(api, '-500', 'т')).resolves.toEqual({
      ok: false,
      reason: 'migrated',
      newChatId: '-1001234567890',
    });
  });

  it("400 can't parse entities — повторяет БЕЗ parse_mode и успевает", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        apiError(400, "Bad Request: can't parse entities: unmatched '*'"),
      )
      .mockResolvedValueOnce({ message_id: 9 });

    const outcome = await postToGroupChat(
      { sendMessage } as unknown as Api,
      '-1',
      'слом*ный',
    );

    expect(outcome).toEqual({ ok: true, messageId: 9 });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[2]).not.toHaveProperty('parse_mode');
  });

  it("классифицирует сбой повтора после can't parse entities", async () => {
    const { api } = apiThatThrows(
      apiError(400, "Bad Request: can't parse entities: unmatched '*'"),
      apiError(403, 'Forbidden: bot was blocked'),
    );

    await expect(postToGroupChat(api, '-1', 'т')).resolves.toMatchObject({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('429 — транзиентная ошибка (не спим внутри шва)', async () => {
    const { api } = apiThatThrows(
      apiError(429, 'Too Many Requests: retry after 30', { retry_after: 30 }),
    );

    await expect(postToGroupChat(api, '-1', 'т')).resolves.toMatchObject({
      ok: false,
      reason: 'transient',
    });
  });

  it('обычная ошибка (сеть) — транзиентная', async () => {
    const { api } = apiThatThrows(new Error('socket hang up'));

    await expect(postToGroupChat(api, '-1', 'т')).resolves.toEqual({
      ok: false,
      reason: 'transient',
      detail: 'socket hang up',
    });
  });

  it('НИКОГДА не бросает — даже на нечеловеческом значении', async () => {
    const { api } = apiThatThrows('строка вместо ошибки');

    await expect(postToGroupChat(api, '-1', 'т')).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe('editGroupMessage', () => {
  function editApi(...results: unknown[]) {
    const editMessageText = vi.fn();
    for (const r of results) {
      if (r instanceof Error || typeof r === 'string') {
        editMessageText.mockRejectedValueOnce(r);
      } else {
        editMessageText.mockResolvedValueOnce(r);
      }
    }
    return { api: { editMessageText } as unknown as Api, editMessageText };
  }

  it('правит текст с клавиатурой', async () => {
    const { api, editMessageText } = editApi({ message_id: 5 });
    const keyboard = new InlineKeyboard().url('Участвовать', 'https://t.me/b');

    await expect(
      editGroupMessage(api, '-1', 5, 'текст', keyboard),
    ).resolves.toEqual({ ok: true });
    expect(editMessageText).toHaveBeenCalledWith('-1', 5, 'текст', {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  });

  it('без клавиатуры явно снимает кнопки', async () => {
    const { api, editMessageText } = editApi({ message_id: 5 });

    await editGroupMessage(api, '-1', 5, 'текст');

    expect(editMessageText.mock.calls[0]?.[3]).toMatchObject({
      reply_markup: { inline_keyboard: [] },
    });
  });

  it('«message is not modified» — успех', async () => {
    const { api } = editApi(
      apiError(
        400,
        'Bad Request: message is not modified: specified new message content and reply markup are exactly the same',
      ),
    );

    await expect(editGroupMessage(api, '-1', 5, 'т')).resolves.toEqual({
      ok: true,
    });
  });

  it.each([
    'Bad Request: message to edit not found',
    "Bad Request: message can't be edited",
    'Bad Request: chat not found',
  ])('400 «%s» — сообщения больше нет', async (description) => {
    const { api } = editApi(apiError(400, description));

    await expect(editGroupMessage(api, '-1', 5, 'т')).resolves.toMatchObject({
      ok: false,
      reason: 'gone',
    });
  });

  it('403 — сообщения больше нет', async () => {
    const { api } = editApi(apiError(403, 'Forbidden: bot was kicked'));

    await expect(editGroupMessage(api, '-1', 5, 'т')).resolves.toMatchObject({
      ok: false,
      reason: 'gone',
    });
  });

  it('400 с migrate_to_chat_id — сообщения больше нет', async () => {
    const { api } = editApi(
      apiError(400, 'Bad Request: group chat was upgraded', {
        migrate_to_chat_id: -100123,
      }),
    );

    await expect(editGroupMessage(api, '-1', 5, 'т')).resolves.toMatchObject({
      ok: false,
      reason: 'gone',
    });
  });

  it('429 — отдаёт retry_after', async () => {
    const { api } = editApi(
      apiError(429, 'Too Many Requests: retry after 17', { retry_after: 17 }),
    );

    await expect(editGroupMessage(api, '-1', 5, 'т')).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
      retryAfterSec: 17,
    });
  });

  it("can't parse entities — повторяет без parse_mode", async () => {
    const { api, editMessageText } = editApi(
      apiError(400, "Bad Request: can't parse entities: unmatched '*'"),
      { message_id: 5 },
    );

    await expect(editGroupMessage(api, '-1', 5, 'т')).resolves.toEqual({
      ok: true,
    });
    expect(editMessageText.mock.calls[1]?.[3]).not.toHaveProperty('parse_mode');
  });

  it('сеть — транзиентная ошибка, не бросает', async () => {
    const { api } = editApi(new Error('socket hang up'));

    await expect(editGroupMessage(api, '-1', 5, 'т')).resolves.toEqual({
      ok: false,
      reason: 'transient',
      detail: 'socket hang up',
    });
  });
});
