import type { NextFunction } from 'grammy';

import type { BotContext } from '../types.js';
import { getActiveWizard } from '../wizards/wizardRegistry.js';

export async function wizardGuardMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const activeWizard = getActiveWizard(userId);
  if (!activeWizard) return next();

  // /cancel всегда разрешён — чтобы пользователь мог выйти из wizard
  if (ctx.hasCommand('cancel')) {
    return next();
  }

  // Callback queries wizard'а проходят свободно
  if (ctx.callbackQuery?.data) {
    if (ctx.callbackQuery.data.startsWith(activeWizard.callbackPrefix)) {
      return next();
    }

    await ctx.answerCallbackQuery({
      text: `Сначала завершите или отмените ${activeWizard.name}`,
      show_alert: false,
    });
    return;
  }

  // Текстовые сообщения (не команды) проходят — wizard их обрабатывает
  if (ctx.message?.text && !ctx.message.text.startsWith('/')) {
    return next();
  }

  // Любые другие команды блокируются
  if (ctx.message?.text?.startsWith('/')) {
    await ctx.reply(
      `Вы находитесь в процессе: ${activeWizard.name}.\n` +
        `Завершите его или отмените командой /cancel`,
    );
    return;
  }

  // Прочие апдейты (фото, стикеры и т.д.) — пропускаем
  return next();
}
