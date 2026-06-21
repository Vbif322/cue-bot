import { Composer } from 'grammy';

import { MENU_BUTTONS } from '../ui/mainMenu.js';
import { getActiveWizard } from '../wizards/wizardRegistry.js';
import type { BotContext } from '../types.js';
import { showMyMatches } from './matchCommands.js';
import { showTournamentsList } from './tournamentCommands.js';
import { showProfile } from './profileCommand.js';

export const menuHandlers = new Composer<BotContext>();

async function isInWizard(ctx: BotContext): Promise<boolean> {
  const userId = ctx.from?.id;
  return userId !== undefined && (await getActiveWizard(userId)) !== undefined;
}

menuHandlers.hears(MENU_BUTTONS.matches, async (ctx, next) => {
  if (await isInWizard(ctx)) return next();
  await showMyMatches(ctx);
});

menuHandlers.hears(MENU_BUTTONS.tournaments, async (ctx, next) => {
  if (await isInWizard(ctx)) return next();
  await showTournamentsList(ctx);
});

menuHandlers.hears(MENU_BUTTONS.profile, async (ctx, next) => {
  if (await isInWizard(ctx)) return next();
  await showProfile(ctx);
});
