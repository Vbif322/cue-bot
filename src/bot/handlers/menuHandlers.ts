import { Composer } from 'grammy';

import { MENU_BUTTONS } from '../ui/mainMenu.js';
import type { BotContext } from '../types.js';
import { showMyMatches } from './matchCommands.js';
import { showTournamentsList } from './tournamentCommands.js';
import { showProfile } from './profileCommand.js';

export const menuHandlers = new Composer<BotContext>();

// Во время wizard'а кнопки меню блокирует guard текстовых сессий, а мягкую
// сессию он завершает до того, как кнопка дойдёт сюда.
menuHandlers.hears(MENU_BUTTONS.matches, (ctx) => showMyMatches(ctx));

menuHandlers.hears(MENU_BUTTONS.tournaments, (ctx) => showTournamentsList(ctx));

menuHandlers.hears(MENU_BUTTONS.profile, (ctx) => showProfile(ctx));
