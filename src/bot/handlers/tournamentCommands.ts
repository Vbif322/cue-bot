import { Composer, InlineKeyboard } from 'grammy';
import { inArray } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { tournaments } from '@/db/schema.js';
import { FORMAT_LABELS, STATUS_LABELS } from '@/utils/constants.js';
import { safeEditMessageText } from '@/utils/messageHelpers.js';
import { getBracketStats } from '@/services/bracketGenerator.js';
import { startTournamentFull } from '@/services/tournamentStartService.js';
import {
  canStartTournament,
  getTournaments,
  getUserTournaments,
  getTournament,
  updateTournamentStatus,
  deleteTournament,
  canDeleteTournament,
  cancelTournament,
  canCancelTournament,
  closeRegistrationWithCount,
} from '@/services/tournamentService.js';
import { notifyTournamentCancelled } from '@/services/notificationService.js';
import type { TournamentStatus } from '@/bot/@types/tournament.js';

import { adminOnly } from '../guards.js';
import { canViewTournament, isAdmin } from '../permissions.js';
import {
  getTournamentInfo,
  buildTournamentMessage,
  buildTournamentKeyboard,
  buildTournamentListItemCompact,
  buildTournamentTabsKeyboard,
} from '../ui/tournamentUI.js';
import type { TournamentTab } from '../ui/tournamentUI.js';
import { getMatchStatusEmoji } from '../ui/matchUI.js';
import { tournamentCreationFlow } from '../wizards/tournamentCreation/tournamentCreation.module.js';
import type { BotContext } from '../types.js';

export const tournamentCommands = new Composer<BotContext>();

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

/**
 * /create_tournament - Start tournament creation wizard
 */
tournamentCommands.command('create_tournament', adminOnly(), async (ctx) => {
  await tournamentCreationFlow.startCreationWizard(ctx);
});

/**
 * /cancel - Cancel tournament creation
 */
tournamentCommands.command('cancel', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const cancelStatus = tournamentCreationFlow.cancelCreation(userId);

  if (cancelStatus) {
    await ctx.reply('Создание турнира отменено.');
  } else {
    await ctx.reply('Нет активного процесса создания турнира.');
  }
});

/** Active (non-terminal) statuses shown under the «Текущие» tab. */
const ACTIVE_STATUSES: TournamentStatus[] = [
  'registration_open',
  'registration_closed',
  'in_progress',
];

const TAB_HEADERS: Record<TournamentTab, string> = {
  current: 'Текущие турниры:\n\n',
  archive: '🏁 Завершённые турниры:\n\n',
  my: '👤 Мои турниры:\n\n',
};

/**
 * Send the current tournaments list to the user. Shared between the
 * `/tournaments` command and onboarding entry points (/start, /help button).
 */
export async function showTournamentsList(
  ctx: BotContext,
  edit = false,
): Promise<void> {
  await renderTournamentsList(ctx, 'current', { edit });
}

/**
 * Render the tabbed tournaments list. `edit: false` replies with a new message
 * (menu / command entry); `edit: true` edits the callback message in place
 * (tab switches). Each tab is capped at 10 rows — no pagination.
 */
async function renderTournamentsList(
  ctx: BotContext,
  tab: TournamentTab,
  { edit }: { edit: boolean },
): Promise<void> {
  const admin = isAdmin(ctx);

  let rows;
  if (tab === 'my') {
    rows = await getUserTournaments(ctx.dbUser.id, { limit: 10 });
  } else if (tab === 'archive') {
    rows = await getTournaments({
      limit: 10,
      statuses: ['completed'],
      includePrivate: admin,
    });
  } else {
    const statuses = admin
      ? [...ACTIVE_STATUSES, 'draft' as TournamentStatus]
      : ACTIVE_STATUSES;
    rows = await getTournaments({ limit: 10, statuses, includePrivate: admin });
  }

  const tournamentsInfo = await Promise.all(
    rows.map((t) => getTournamentInfo(t, ctx.dbUser.id)),
  );

  let message = TAB_HEADERS[tab];
  if (tournamentsInfo.length === 0) {
    message += 'В этой категории турниров нет.';
  } else {
    for (const info of tournamentsInfo) {
      message += buildTournamentListItemCompact(info, admin);
    }
  }

  const keyboard = buildTournamentTabsKeyboard(tab, tournamentsInfo);

  if (edit) {
    await safeEditMessageText(ctx, {
      text: message,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

/**
 * /tournaments - List all tournaments
 */
tournamentCommands.command('tournaments', (ctx) => showTournamentsList(ctx));

/**
 * /delete_tournament [id] - Delete a tournament
 */
tournamentCommands.command('delete_tournament', adminOnly(), async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1) ?? [];
  const firstArg = args[0];

  // If no ID provided, show selection menu
  if (!firstArg || firstArg.trim() === '') {
    const deletableTournaments = await db.query.tournaments.findMany({
      where: inArray(tournaments.status, ['draft', 'cancelled']),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 10,
    });

    if (deletableTournaments.length === 0) {
      await ctx.reply(
        "Нет турниров, доступных для удаления.\n\nУдалить можно только турниры в статусе 'Черновик' или 'Отменён'.",
      );
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const t of deletableTournaments) {
      const statusEmoji = t.status === 'draft' ? '📝' : '❌';
      keyboard
        .text(`${statusEmoji} ${t.name}`, `tournament_delete_confirm:${t.id}`)
        .row();
    }

    await ctx.reply('Выберите турнир для удаления:', {
      reply_markup: keyboard,
    });
    return;
  }

  // Delete tournament by ID
  await handleTournamentDeletion(ctx, firstArg as UUID);
});

// ============================================================================
// CALLBACK HANDLERS - Tournament Management
// ============================================================================

/**
 * Switch tournament list tab (Текущие / Завершённые / Мои) — edits in place.
 */
tournamentCommands.callbackQuery(/^tlist:(current|archive|my)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderTournamentsList(ctx, ctx.match[1] as TournamentTab, {
    edit: true,
  });
});

/**
 * Show tournament info when selected from list
 */
tournamentCommands.callbackQuery(/^tournament_info:(.+)$/, async (ctx) => {
  const tournamentId = ctx.match[1];
  if (!tournamentId) return;
  await ctx.answerCallbackQuery();
  await showTournamentDetails(ctx, tournamentId as UUID, true);
});

/**
 * Open tournament registration
 */
tournamentCommands.callbackQuery(/^tournament_open_reg:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery('Недостаточно прав');
    return;
  }

  const tournamentId = ctx.match[1];
  if (!tournamentId) return;
  await updateTournamentStatus(tournamentId as UUID, 'registration_open');

  await ctx.answerCallbackQuery('Регистрация открыта');
  await safeEditMessageText(ctx, {
    text:
      (ctx.callbackQuery.message?.text ?? '') +
      `\n\n${getMatchStatusEmoji('completed')} Регистрация открыта!`,
  });
});

/**
 * Close tournament registration
 */
tournamentCommands.callbackQuery(/^tournament_close_reg:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery('Недостаточно прав');
    return;
  }

  const tournamentId = ctx.match[1];
  if (!tournamentId) return;

  try {
    // Close registration and get participant count
    const count = await closeRegistrationWithCount(tournamentId as UUID);

    await ctx.answerCallbackQuery('Регистрация закрыта');
    await safeEditMessageText(ctx, {
      text:
        (ctx.callbackQuery.message?.text ?? '') +
        '\n\n🔒 Регистрация закрыта!\n' +
        `Участников: ${String(count)}`,
    });
  } catch (error) {
    console.error('Error closing registration:', error);
    await ctx.answerCallbackQuery({
      text: 'Ошибка при закрытии регистрации',
      show_alert: true,
    });
  }
});

/**
 * Delete tournament (final confirmation)
 */
tournamentCommands.callbackQuery(/^tournament_delete:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery('Недостаточно прав');
    return;
  }

  const tournamentId = ctx.match[1];
  if (!tournamentId) return;
  await deleteTournament(tournamentId as UUID);

  await ctx.answerCallbackQuery('Турнир удалён');
  await safeEditMessageText(ctx, {
    text: '🗑 Турнир удалён',
  });
});

/**
 * Show delete confirmation dialog
 */
tournamentCommands.callbackQuery(
  /^tournament_delete_confirm:(.+)$/,
  async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery('Недостаточно прав');
      return;
    }

    const tournamentId = ctx.match[1];
    if (!tournamentId) return;
    const tournament = await getTournament(tournamentId as UUID);

    if (!tournament) {
      await ctx.answerCallbackQuery({
        text: 'Турнир не найден',
        show_alert: true,
      });
      return;
    }

    if (!canDeleteTournament(tournament.status)) {
      await ctx.answerCallbackQuery({
        text: 'Этот турнир больше нельзя удалить',
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard()
      .text(
        `${getMatchStatusEmoji('completed')} Да, удалить`,
        `tournament_delete:${tournament.id}`,
      )
      .text(
        `${getMatchStatusEmoji('cancelled')} Отмена`,
        `tournament_delete_cancel`,
      );

    await safeEditMessageText(ctx, {
      text:
        `Вы уверены, что хотите удалить турнир?\n\n` +
        `📋 *${tournament.name}*\n` +
        `Статус: ${STATUS_LABELS[tournament.status as keyof typeof STATUS_LABELS] ?? tournament.status}`,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  },
);

/**
 * Cancel tournament deletion
 */
tournamentCommands.callbackQuery('tournament_delete_cancel', async (ctx) => {
  await ctx.answerCallbackQuery('Удаление отменено');
  await safeEditMessageText(ctx, {
    text: 'Удаление отменено.',
  });
});

/**
 * Show tournament cancellation confirmation dialog
 */
tournamentCommands.callbackQuery(
  /^tournament_cancel_confirm:(.+)$/,
  async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery('Недостаточно прав');
      return;
    }

    const tournamentId = ctx.match[1];
    if (!tournamentId) return;
    const tournament = await getTournament(tournamentId as UUID);

    if (!tournament) {
      await ctx.answerCallbackQuery({
        text: 'Турнир не найден',
        show_alert: true,
      });
      return;
    }

    if (!canCancelTournament(tournament.status)) {
      await ctx.answerCallbackQuery({
        text: 'Этот турнир нельзя отменить',
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard()
      .text(
        `${getMatchStatusEmoji('cancelled')} Да, отменить`,
        `tournament_cancel:${tournament.id}`,
      )
      .text(`${getMatchStatusEmoji('completed')} Нет`, `tournament_cancel_abort`);

    await safeEditMessageText(ctx, {
      text:
        `Вы уверены, что хотите отменить турнир?\n` +
        `Участники получат уведомление, а незавершённые матчи будут отменены.\n\n` +
        `📋 *${tournament.name}*\n` +
        `Статус: ${STATUS_LABELS[tournament.status as keyof typeof STATUS_LABELS] ?? tournament.status}`,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  },
);

/**
 * Cancel tournament (final confirmation)
 */
tournamentCommands.callbackQuery(/^tournament_cancel:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery('Недостаточно прав');
    return;
  }

  const tournamentId = ctx.match[1];
  if (!tournamentId) return;
  const tournament = await getTournament(tournamentId as UUID);

  if (!tournament) {
    await ctx.answerCallbackQuery({ text: 'Турнир не найден', show_alert: true });
    return;
  }

  if (!canCancelTournament(tournament.status)) {
    await ctx.answerCallbackQuery({
      text: 'Этот турнир нельзя отменить',
      show_alert: true,
    });
    return;
  }

  await cancelTournament(tournamentId as UUID);
  await notifyTournamentCancelled(ctx.api, tournamentId as UUID, tournament.name);

  await ctx.answerCallbackQuery('Турнир отменён');
  await safeEditMessageText(ctx, {
    text: `❌ Турнир "${tournament.name}" отменён.`,
  });
});

/**
 * Abort tournament cancellation
 */
tournamentCommands.callbackQuery('tournament_cancel_abort', async (ctx) => {
  await ctx.answerCallbackQuery('Отмена отменена');
  await safeEditMessageText(ctx, {
    text: 'Отмена турнира отменена.',
  });
});

// ============================================================================
// CALLBACK HANDLERS - Tournament Start
// ============================================================================

/**
 * Show tournament start confirmation
 */
tournamentCommands.callbackQuery(/^tournament_start:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery('Недостаточно прав');
    return;
  }

  const tournamentId = ctx.match[1];
  if (!tournamentId) return;
  const result = await canStartTournament(tournamentId as UUID);

  if (!result.canStart) {
    await ctx.answerCallbackQuery({
      text: result.error ?? 'Невозможно запустить турнир',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery();

  const tournament = await getTournament(tournamentId as UUID);

  if (!tournament) {
    await safeEditMessageText(ctx, {
      text: 'Турнир не найден',
    });
    return;
  }

  const stats = getBracketStats(
    tournament.format,
    result.participantsCount,
    tournament.mergeRound,
  );

  const keyboard = new InlineKeyboard()
    .text(
      `${getMatchStatusEmoji('completed')} Да, начать турнир`,
      `tournament_start_confirm:${tournamentId}`,
    )
    .row()
    .text(
      `${getMatchStatusEmoji('cancelled')} Отмена`,
      `tournament_info:${tournamentId}`,
    );

  await safeEditMessageText(ctx, {
    text:
      `🚀 *Запуск турнира "${tournament.name}"*\n\n` +
      `Участников: ${String(result.participantsCount)}\n` +
      `Формат: ${FORMAT_LABELS[tournament.format]}\n` +
      `Матчей будет создано: ${String(stats.totalMatches)}\n` +
      `Раундов: ${String(stats.totalRounds)}\n\n` +
      `⚠️ После запуска:\n` +
      `• Сиды будут назначены случайным образом\n` +
      `• Сетка будет сформирована автоматически\n` +
      `• Регистрация новых участников будет невозможна\n\n` +
      `Вы уверены?`,
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

/**
 * Confirm and start tournament
 */
tournamentCommands.callbackQuery(
  /^tournament_start_confirm:(.+)$/,
  async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery('Недостаточно прав');
      return;
    }

    const tournamentId = ctx.match[1];
    if (!tournamentId) return;

    // Double-check if tournament can be started
    const result = await canStartTournament(tournamentId as UUID);

    if (!result.canStart) {
      await ctx.answerCallbackQuery({
        text: result.error ?? 'Невозможно запустить турнир',
        show_alert: true,
      });
      return;
    }

    const tournament = await getTournament(tournamentId as UUID);

    if (!tournament) {
      await ctx.answerCallbackQuery({
        text: 'Турнир не найден',
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery('Запуск турнира...');

    try {
      const startResult = await startTournamentFull(tournamentId as UUID, ctx.api);

      const keyboard = new InlineKeyboard()
        .text('📊 Посмотреть сетку', `bracket:view:${tournamentId}`)
        .row();

      await safeEditMessageText(ctx, {
        text:
          `${getMatchStatusEmoji('completed')} *Турнир "${startResult.tournamentName}" запущен!*\n\n` +
          `Участников: ${String(startResult.participantsCount)}\n` +
          `Матчей создано: ${String(startResult.matchesCreated)}\n\n` +
          `Сетка сформирована, участники получили уведомления.\n` +
          `Используйте /my\\_match для просмотра своего текущего матча.`,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error('Error starting tournament:', error);
      await safeEditMessageText(ctx, {
        text: `❌ Ошибка при запуске турнира:\n${error instanceof Error ? error.message : 'Неизвестная ошибка'}`,
      });
    }
  },
);

// ============================================================================
// CALLBACK HANDLERS - Tournament Creation Wizard
// ============================================================================

tournamentCommands.callbackQuery(/^tc:visibility:(.+)$/, async (ctx) => {
  const val = ctx.match[1];
  if (!val) return;
  await tournamentCreationFlow.handleVisibilitySelection(ctx, val);
});

tournamentCommands.callbackQuery(/^tc:schedule:(.+)$/, async (ctx) => {
  const val = ctx.match[1];
  if (!val) return;
  await tournamentCreationFlow.handleScheduleModeSelection(ctx, val);
});

tournamentCommands.callbackQuery(/^tc:discipline:(.+)$/, async (ctx) => {
  const val = ctx.match[1];
  if (!val) return;
  await tournamentCreationFlow.handleDisciplineSelection(ctx, val);
});

tournamentCommands.callbackQuery(/^tc:venue:(.+)$/, async (ctx) => {
  const val = ctx.match[1];
  if (!val) return;
  await tournamentCreationFlow.handleVenueSelection(ctx, val as UUID);
});

tournamentCommands.callbackQuery(/^tc:format:(.+)$/, async (ctx) => {
  const val = ctx.match[1];
  if (!val) return;
  await tournamentCreationFlow.handleFormatSelection(ctx, val);
});

tournamentCommands.callbackQuery(/^tc:random:(true|false)$/, async (ctx) => {
  const val = ctx.match[1];
  if (!val) return;
  await tournamentCreationFlow.handleRandomModeSelection(ctx, val === 'true');
});

tournamentCommands.callbackQuery(/^tc:participants:(\d+)$/, async (ctx) => {
  const val = ctx.match[1];
  if (!val) return;
  const participants = parseInt(val, 10);
  await tournamentCreationFlow.handleMaxParticipantsSelection(
    ctx,
    participants,
  );
});

tournamentCommands.callbackQuery(/^tc:merge:(\d+)$/, async (ctx) => {
  const val = ctx.match[1];
  if (!val) return;
  const mergeRound = parseInt(val, 10);
  await tournamentCreationFlow.handleMergeRoundSelection(ctx, mergeRound);
});

tournamentCommands.callbackQuery(/^tc:winscore:(\d+)$/, async (ctx) => {
  const val = ctx.match[1];
  if (!val) return;
  const winScore = parseInt(val, 10);
  await tournamentCreationFlow.handleWinScoreSelection(ctx, winScore);
});

tournamentCommands.callbackQuery(/^tc:tables_toggle:(.+)$/, async (ctx) => {
  const val = ctx.match[1];
  if (!val) return;
  await tournamentCreationFlow.handleTableSelectionToggle(ctx, val as UUID);
});

tournamentCommands.callbackQuery('tc:tables_all', async (ctx) => {
  await tournamentCreationFlow.handleTableSelectAll(ctx);
});

tournamentCommands.callbackQuery('tc:tables_done', async (ctx) => {
  await tournamentCreationFlow.handleTableSelectionFinalize(ctx, false);
});

tournamentCommands.callbackQuery('tc:tables_skip', async (ctx) => {
  await tournamentCreationFlow.handleTableSelectionFinalize(ctx, true);
});

// ============================================================================
// TEXT MESSAGE HANDLER - Tournament Creation Wizard
// ============================================================================

tournamentCommands.on('message:text', async (ctx, next) => {
  const userId = ctx.from.id;
  const state = tournamentCreationFlow.getCreationState(userId);

  if (!state) {
    return next();
  }

  const text = ctx.message.text;

  if (state.step === 'name') {
    if (await tournamentCreationFlow.handleNameInput(ctx, text)) return;
  }

  if (state.step === 'date') {
    if (await tournamentCreationFlow.handleStartDateInput(ctx, text)) return;
  }

  return next();
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Show tournament details (reusable for both command and callback)
 */
async function showTournamentDetails(
  ctx: BotContext,
  tournamentId: UUID,
  editMessage = false,
): Promise<void> {
  const tournament = await getTournament(tournamentId);

  // Same response for "missing" and "forbidden" so a private tournament's
  // existence is not leaked to users without access.
  if (!tournament || !(await canViewTournament(ctx, tournament))) {
    const errorMsg = 'Турнир не найден.';
    if (editMessage) {
      await ctx.answerCallbackQuery({ text: errorMsg, show_alert: true });
    } else {
      await ctx.reply(errorMsg);
    }
    return;
  }

  const info = await getTournamentInfo(tournament, ctx.dbUser.id);
  const message = buildTournamentMessage(info, isAdmin(ctx));
  const keyboard = buildTournamentKeyboard(info, isAdmin(ctx));

  if (editMessage) {
    await safeEditMessageText(ctx, {
      text: message,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

/**
 * Handle tournament deletion
 */
async function handleTournamentDeletion(
  ctx: BotContext,
  tournamentId: UUID,
): Promise<void> {
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    await ctx.reply('Турнир не найден');
    return;
  }

  if (!canDeleteTournament(tournament.status)) {
    await ctx.reply(
      "Можно удалить только турниры в статусе 'Черновик' или 'Отменён'",
    );
    return;
  }

  await deleteTournament(tournamentId);
  await ctx.reply(`Турнир "${tournament.name}" удалён`);
}
