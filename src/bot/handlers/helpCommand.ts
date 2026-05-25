import { Composer, InlineKeyboard } from 'grammy';

import type { BotContext } from '../types.js';
import { showTournamentsList } from './tournamentCommands.js';

export const helpCommands = new Composer<BotContext>();

const ONBOARDING_TEXT =
  '🎱 *Это бот для проведения бильярдных турниров.*\n\n' +
  'Основные сценарии:\n' +
  '• 📋 *Записаться на турнир* — открой список турниров и нажми «Участвовать».\n' +
  '• 🎯 *Играть матч* — когда турнир стартует, открой «Мои матчи» и начни игру.\n' +
  '• ✅ *Подтвердить счёт* — после матча соперник вносит счёт, тебе придёт уведомление с кнопками «Подтвердить» / «Оспорить».';

export function buildOnboardingKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('📋 Текущие турниры', 'menu:tournaments');
}

export async function sendOnboarding(
  ctx: BotContext,
  greeting?: string,
): Promise<void> {
  const text = greeting ? `${greeting}\n\n${ONBOARDING_TEXT}` : ONBOARDING_TEXT;
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: buildOnboardingKeyboard(),
  });
}

helpCommands.command('help', (ctx) => sendOnboarding(ctx));

helpCommands.callbackQuery('menu:tournaments', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showTournamentsList(ctx);
});
