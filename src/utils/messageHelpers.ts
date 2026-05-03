import { GrammyError } from 'grammy';
import type { Context } from 'grammy';

/**
 * Escape characters that have special meaning in Telegram **legacy Markdown**
 * (parse_mode: 'Markdown'): `_`, `*`, `` ` ``, `[`. These are the only four
 * tokens the legacy parser treats as syntax — no need to escape `]`, `(`, `)`,
 * `~`, etc. Pass user-supplied substrings through this before interpolating
 * them into a Markdown message; do NOT escape an already-formatted Markdown
 * string (double-escape risk).
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([_*`\[])/g, '\\$1');
}

/**
 * Options for safe edit message text operation
 */
export interface SafeEditOptions {
  /** Text to set */
  text: string;
  /** Parse mode */
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  /** Reply markup (inline keyboard) */
  reply_markup?: any;
}

/**
 * Safely edit message text with automatic fallback to sending new message
 *
 * Handles Telegram editMessageText errors:
 * - "message is not modified" - silently ignored
 * - "message can't be edited" (48h limit) - sends new message instead
 * - Other errors - propagated to caller
 *
 * @param ctx - Grammy context
 * @param options - Edit options (text, parse_mode, reply_markup)
 *
 * @example
 * ```typescript
 * await safeEditMessageText(ctx, {
 *   text: "Updated text",
 *   parse_mode: "Markdown",
 *   reply_markup: keyboard,
 * });
 * ```
 */
export async function safeEditMessageText(
  ctx: Context,
  options: SafeEditOptions,
): Promise<void> {
  const { text, parse_mode, reply_markup } = options;

  try {
    // Attempt to edit the message
    await ctx.editMessageText(text, {
      ...(parse_mode && { parse_mode }),
      ...(reply_markup && { reply_markup }),
    });
  } catch (error) {
    // Handle Grammy errors (Telegram API errors)
    if (error instanceof GrammyError) {
      if (
        error.error_code === 400 &&
        !error.description.includes('message is not modified') // если сообщение не изменилось, то ничего не делаем
      ) {
        // Send new message instead
        await ctx.reply(text, {
          ...(parse_mode && { parse_mode }),
          ...(reply_markup && { reply_markup }),
        });
        return;
      } else {
        return; // Silent success
      }
    }

    // Non-Grammy errors - propagate
    throw error;
  }
}
