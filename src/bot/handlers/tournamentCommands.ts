import { Composer, InlineKeyboard } from "grammy";
import { inArray } from "drizzle-orm";
import { db } from "../../db/db.js";
import { tournaments } from "../../db/schema.js";
import type { BotContext } from "../types.js";
import { adminOnly } from "../guards.js";
import { isAdmin } from "../permissions.js";
import { safeEditMessageText } from "../../utils/messageHelpers.js";
import {
  canStartTournament,
  getTournament,
  updateTournamentStatus,
  deleteTournament,
  canDeleteTournament,
  closeRegistrationWithCount,
} from "../../services/tournamentService.js";
import {
  getBracketStats,
} from "../../services/bracketGenerator.js";
import { startTournamentFull } from "../../services/tournamentStartService.js";
import { FORMAT_LABELS, STATUS_LABELS } from "../../utils/constants.js";
import {
  getTournamentInfo,
  buildTournamentMessage,
  buildTournamentKeyboard,
  buildTournamentListItem,
  buildTournamentListKeyboard,
  buildTournamentSelectionKeyboard,
} from "../ui/tournamentUI.js";
import {
  startCreationWizard,
  cancelCreation,
  getCreationState,
  handleNameInput,
  handleDateInput,
  handleDisciplineSelection,
  handleFormatSelection,
  handleMaxParticipantsSelection,
  handleWinScoreSelection,
} from "../wizards/tournamentCreationWizard.js";

export const tournamentCommands = new Composer<BotContext>();

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

/**
 * /create_tournament - Start tournament creation wizard
 */
tournamentCommands.command("create_tournament", adminOnly(), async (ctx) => {
  const userId = ctx.from!.id;

  const msg = await ctx.reply(
    "Создание нового турнира\n\n" + `Шаг 1/6: Введите название турнира:`,
  );

  startCreationWizard(userId, msg.message_id);
});

/**
 * /cancel - Cancel tournament creation
 */
tournamentCommands.command("cancel", async (ctx) => {
  const userId = ctx.from!.id;

  if (cancelCreation(userId)) {
    await ctx.reply("Создание турнира отменено.");
  } else {
    await ctx.reply("Нет активного процесса создания турнира.");
  }
});

/**
 * /tournaments - List all tournaments
 */
tournamentCommands.command("tournaments", async (ctx) => {
  const admin = isAdmin(ctx);

  // Get all tournaments
  const allTournaments = await db.query.tournaments.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 10,
  });

  if (allTournaments.length === 0) {
    await ctx.reply("Турниров пока нет.");
    return;
  }

  // Filter tournaments for regular users (hide drafts)
  const visibleTournaments = admin
    ? allTournaments
    : allTournaments.filter((t) => t.status !== "draft");

  if (visibleTournaments.length === 0) {
    await ctx.reply("Турниров пока нет.");
    return;
  }

  // Get tournament info with participation status
  const tournamentsInfo = await Promise.all(
    visibleTournaments.map((t) => getTournamentInfo(t, ctx.dbUser.id)),
  );

  const currentTournaments = tournamentsInfo.filter(
    (tournament) => tournament.status !== "completed",
  );

  // Build message
  let message = "Список турниров:\n\n";
  for (const info of currentTournaments) {
    message += buildTournamentListItem(info, admin);
  }

  // Build keyboard
  const keyboard = buildTournamentListKeyboard(currentTournaments);

  if (keyboard.inline_keyboard.length > 0) {
    await ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(message, { parse_mode: "Markdown" });
  }
});

/**
 * /tournament [id] - Show tournament details
 */
tournamentCommands.command("tournament", async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);
  const admin = isAdmin(ctx);

  // If no ID provided, show selection menu
  if (!args || args.length === 0 || args[0]?.trim() === "") {
    const allTournaments = await db.query.tournaments.findMany({
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 10,
    });

    const visibleTournaments = admin
      ? allTournaments
      : allTournaments.filter((t) => t.status !== "draft");

    if (visibleTournaments.length === 0) {
      await ctx.reply("Турниров пока нет.");
      return;
    }

    const keyboard = buildTournamentSelectionKeyboard(visibleTournaments);
    await ctx.reply("Выберите турнир:", { reply_markup: keyboard });
    return;
  }

  // Show tournament details
  await showTournamentDetails(ctx, args[0]!);
});

/**
 * /delete_tournament [id] - Delete a tournament
 */
tournamentCommands.command("delete_tournament", adminOnly(), async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);

  // If no ID provided, show selection menu
  if (!args || args.length === 0 || args[0]?.trim() === "") {
    const deletableTournaments = await db.query.tournaments.findMany({
      where: inArray(tournaments.status, ["draft", "cancelled"]),
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
      const statusEmoji = t.status === "draft" ? "📝" : "❌";
      keyboard
        .text(`${statusEmoji} ${t.name}`, `tournament_delete_confirm:${t.id}`)
        .row();
    }

    await ctx.reply("Выберите турнир для удаления:", {
      reply_markup: keyboard,
    });
    return;
  }

  // Delete tournament by ID
  await handleTournamentDeletion(ctx, args[0]!);
});

// ============================================================================
// CALLBACK HANDLERS - Tournament Management
// ============================================================================

/**
 * Show tournament info when selected from list
 */
tournamentCommands.callbackQuery(/^tournament_info:(.+)$/, async (ctx) => {
  const tournamentId = ctx.match![1]!;
  await ctx.answerCallbackQuery();
  await showTournamentDetails(ctx, tournamentId, true);
});

/**
 * Open tournament registration
 */
tournamentCommands.callbackQuery(/^tournament_open_reg:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery("Недостаточно прав");
    return;
  }

  const tournamentId = ctx.match![1]!;
  await updateTournamentStatus(tournamentId, "registration_open");

  await ctx.answerCallbackQuery("Регистрация открыта");
  await safeEditMessageText(ctx, {
    text: ctx.callbackQuery.message?.text + "\n\n✅ Регистрация открыта!",
  });
});

/**
 * Close tournament registration
 */
tournamentCommands.callbackQuery(/^tournament_close_reg:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery("Недостаточно прав");
    return;
  }

  const tournamentId = ctx.match![1]!;

  try {
    // Close registration and get participant count
    const count = await closeRegistrationWithCount(tournamentId);

    await ctx.answerCallbackQuery("Регистрация закрыта");
    await safeEditMessageText(ctx, {
      text:
        ctx.callbackQuery.message?.text +
        "\n\n🔒 Регистрация закрыта!\n" +
        `Участников: ${count}`,
    });
  } catch (error) {
    console.error("Error closing registration:", error);
    await ctx.answerCallbackQuery({
      text: "Ошибка при закрытии регистрации",
      show_alert: true,
    });
  }
});

/**
 * Delete tournament (final confirmation)
 */
tournamentCommands.callbackQuery(/^tournament_delete:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery("Недостаточно прав");
    return;
  }

  const tournamentId = ctx.match![1]!;
  await deleteTournament(tournamentId);

  await ctx.answerCallbackQuery("Турнир удалён");
  await safeEditMessageText(ctx, {
    text: "🗑 Турнир удалён",
  });
});

/**
 * Show delete confirmation dialog
 */
tournamentCommands.callbackQuery(
  /^tournament_delete_confirm:(.+)$/,
  async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.answerCallbackQuery("Недостаточно прав");
      return;
    }

    const tournamentId = ctx.match![1]!;
    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      await ctx.answerCallbackQuery({
        text: "Турнир не найден",
        show_alert: true,
      });
      return;
    }

    if (!canDeleteTournament(tournament.status)) {
      await ctx.answerCallbackQuery({
        text: "Этот турнир больше нельзя удалить",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard()
      .text("✅ Да, удалить", `tournament_delete:${tournament.id}`)
      .text("❌ Отмена", `tournament_delete_cancel`);

    await safeEditMessageText(ctx, {
      text:
        `Вы уверены, что хотите удалить турнир?\n\n` +
        `📋 *${tournament.name}*\n` +
        `Статус: ${STATUS_LABELS[tournament.status as keyof typeof STATUS_LABELS] || tournament.status}`,
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  },
);

/**
 * Cancel tournament deletion
 */
tournamentCommands.callbackQuery("tournament_delete_cancel", async (ctx) => {
  await ctx.answerCallbackQuery("Удаление отменено");
  await safeEditMessageText(ctx, {
    text: "Удаление отменено.",
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
    await ctx.answerCallbackQuery("Недостаточно прав");
    return;
  }

  const tournamentId = ctx.match![1]!;
  const result = await canStartTournament(tournamentId);

  if (!result.canStart) {
    await ctx.answerCallbackQuery({
      text: result.error || "Невозможно запустить турнир",
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery();

  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    await safeEditMessageText(ctx, {
      text: "Турнир не найден",
    });
    return;
  }

  const stats = getBracketStats(
    tournament.format as
      | "single_elimination"
      | "double_elimination"
      | "round_robin",
    result.participantsCount,
  );

  const keyboard = new InlineKeyboard()
    .text("✅ Да, начать турнир", `tournament_start_confirm:${tournamentId}`)
    .row()
    .text("❌ Отмена", `tournament_info:${tournamentId}`);

  await safeEditMessageText(ctx, {
    text:
      `🚀 *Запуск турнира "${tournament.name}"*\n\n` +
      `Участников: ${result.participantsCount}\n` +
      `Формат: ${FORMAT_LABELS[tournament.format] || tournament.format}\n` +
      `Матчей будет создано: ${stats.totalMatches}\n` +
      `Раундов: ${stats.totalRounds}\n\n` +
      `⚠️ После запуска:\n` +
      `• Сиды будут назначены случайным образом\n` +
      `• Сетка будет сформирована автоматически\n` +
      `• Регистрация новых участников будет невозможна\n\n` +
      `Вы уверены?`,
    parse_mode: "Markdown",
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
      await ctx.answerCallbackQuery("Недостаточно прав");
      return;
    }

    const tournamentId = ctx.match![1]!;

    // Double-check if tournament can be started
    const result = await canStartTournament(tournamentId);

    if (!result.canStart) {
      await ctx.answerCallbackQuery({
        text: result.error || "Невозможно запустить турнир",
        show_alert: true,
      });
      return;
    }

    const tournament = await getTournament(tournamentId);

    if (!tournament) {
      await ctx.answerCallbackQuery({
        text: "Турнир не найден",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery("Запуск турнира...");

    try {
      const startResult = await startTournamentFull(tournamentId, ctx.api);

      const keyboard = new InlineKeyboard()
        .text("📊 Посмотреть сетку", `bracket:view:${tournamentId}`)
        .row();

      await safeEditMessageText(ctx, {
        text:
          `✅ *Турнир "${startResult.tournamentName}" запущен!*\n\n` +
          `Участников: ${startResult.participantsCount}\n` +
          `Матчей создано: ${startResult.matchesCreated}\n\n` +
          `Сетка сформирована, участники получили уведомления.\n` +
          `Используйте /my\\_match для просмотра своего текущего матча.`,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error("Error starting tournament:", error);
      await safeEditMessageText(ctx, {
        text: `❌ Ошибка при запуске турнира:\n${error instanceof Error ? error.message : "Неизвестная ошибка"}`,
      });
    }
  },
);

// ============================================================================
// CALLBACK HANDLERS - Tournament Creation Wizard
// ============================================================================

tournamentCommands.callbackQuery(/^discipline:(.+)$/, async (ctx) => {
  await handleDisciplineSelection(ctx, ctx.match![1]!);
});

tournamentCommands.callbackQuery(/^format:(.+)$/, async (ctx) => {
  await handleFormatSelection(ctx, ctx.match![1]!);
});

tournamentCommands.callbackQuery(/^participants:(\d+)$/, async (ctx) => {
  const participants = parseInt(ctx.match![1]!, 10);
  await handleMaxParticipantsSelection(ctx, participants);
});

tournamentCommands.callbackQuery(/^winscore:(\d+)$/, async (ctx) => {
  const winScore = parseInt(ctx.match![1]!, 10);
  await handleWinScoreSelection(ctx, winScore);
});

// ============================================================================
// TEXT MESSAGE HANDLER - Tournament Creation Wizard
// ============================================================================

tournamentCommands.on("message:text", async (ctx, next) => {
  const userId = ctx.from.id;
  const state = getCreationState(userId);

  if (!state || !state.lastMessageId) {
    return next();
  }

  const text = ctx.message.text;

  if (state.step === "name") {
    if (await handleNameInput(ctx, text)) return;
  }

  if (state.step === "date") {
    if (await handleDateInput(ctx, text)) return;
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
  tournamentId: string,
  editMessage: boolean = false,
): Promise<void> {
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    const errorMsg = "Турнир не найден.";
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
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
}

/**
 * Handle tournament deletion
 */
async function handleTournamentDeletion(
  ctx: BotContext,
  tournamentId: string,
): Promise<void> {
  const tournament = await getTournament(tournamentId);

  if (!tournament) {
    await ctx.reply("Турнир не найден");
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
