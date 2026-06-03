import { Composer, InlineKeyboard } from 'grammy';

import type { BotContext } from '../types.js';
import { showTournamentsList } from './tournamentCommands.js';

export const helpCommands = new Composer<BotContext>();

const ONBOARDING_TEXT =
  'Это бот для проведения бильярдных турниров\n\n' +
  'Как пользоваться:\n' +
  '• Нажимай кнопку ниже "Текущиие турниры" или на команду /tournaments \n' +
  '• Выбирай турнир и нажимай участвовать\n' +
  '• Бот пришлет тебе уведомление о назначенном матче';

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
  await showTournamentsList(ctx, true);
});
