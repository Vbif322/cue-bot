import { vi } from 'vitest';

/**
 * Minimal stub of grammy's `Api` for services that send Telegram messages.
 * Cast to the real `Api` type at the call site (`as unknown as Api`). Expand
 * with more methods as services under test require them.
 */
export function createMockBotApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
  };
}

export type MockBotApi = ReturnType<typeof createMockBotApi>;
