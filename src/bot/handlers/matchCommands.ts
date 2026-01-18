import { Composer, InlineKeyboard } from "grammy";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../db/db.js";
import { tournaments, matches, users } from "../../db/schema.js";
import type { BotContext } from "../types.js";
import { isAdmin } from "../permissions.js";
import {
  getMatch,
  getPlayerActiveMatches,
  getTournamentMatches,
  reportResult,
  confirmResult,
  disputeResult,
  setTechnicalResult,
  getMatchStats,
  startMatch,
  type MatchWithPlayers,
} from "../../services/matchService.js";
import { getRoundName, calculateRounds, getNextPowerOfTwo } from "../../services/bracketGenerator.js";

export const matchCommands = new Composer<BotContext>();

/**
 * Format player name for display
 */
function formatPlayerName(username: string | null, name: string | null): string {
  if (username) return `@${username}`;
  if (name) return name;
  return "Участник";
}

/**
 * Get match status emoji
 */
function getMatchStatusEmoji(status: string): string {
  switch (status) {
    case "scheduled":
      return "⏳";
    case "in_progress":
      return "🎱";
    case "pending_confirmation":
      return "⏸️";
    case "completed":
      return "✅";
    case "cancelled":
      return "❌";
    default:
      return "❓";
  }
}

/**
 * Format match card
 */
function formatMatchCard(match: MatchWithPlayers, tournament: typeof tournaments.$inferSelect): string {
  const player1 = formatPlayerName(match.player1Username ?? null, match.player1Name ?? null);
  const player2 = formatPlayerName(match.player2Username ?? null, match.player2Name ?? null);

  const bracketSize = getNextPowerOfTwo(tournament.maxParticipants);
  const totalRounds = calculateRounds(bracketSize);
  const roundName = getRoundName(match.round, totalRounds, tournament.format, match.bracketType || "winners");

  let text = `🎱 *Матч #${match.position}*\n`;
  text += `${roundName}\n\n`;
  text += `${player1}\n`;
  text += `vs\n`;
  text += `${player2}\n\n`;

  if (match.status === "completed" || match.status === "pending_confirmation") {
    text += `Счёт: ${match.player1Score ?? 0} : ${match.player2Score ?? 0}\n`;
  }

  if (match.winnerId && match.status === "completed") {
    const winnerName = formatPlayerName(match.winnerUsername ?? null, match.winnerName ?? null);
    text += `Победитель: ${winnerName}\n`;
  }

  text += `\nСтатус: ${getMatchStatusEmoji(match.status)} `;
  switch (match.status) {
    case "scheduled":
      text += "Ожидает начала";
      break;
    case "in_progress":
      text += "В процессе";
      break;
    case "pending_confirmation":
      text += "Ожидает подтверждения";
      break;
    case "completed":
      text += "Завершён";
      break;
    case "cancelled":
      text += "Отменён";
      break;
  }

  if (match.isTechnicalResult) {
    text += `\n⚠️ Технический результат: ${match.technicalReason || "не указана причина"}`;
  }

  return text;
}

/**
 * Get keyboard for match based on user role and match status
 */
function getMatchKeyboard(
  match: MatchWithPlayers,
  userId: string,
  tournament: typeof tournaments.$inferSelect,
  isAdminUser: boolean
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const isPlayer1 = match.player1Id === userId;
  const isPlayer2 = match.player2Id === userId;
  const isParticipant = isPlayer1 || isPlayer2;

  // Match in progress - allow reporting result
  if (match.status === "in_progress" && isParticipant) {
    keyboard.text("📝 Внести результат", `match:report:${match.id}`).row();
  }

  // Scheduled match - allow starting (if both players are set)
  if (match.status === "scheduled" && match.player1Id && match.player2Id && isParticipant) {
    keyboard.text("▶️ Начать матч", `match:start:${match.id}`).row();
  }

  // Pending confirmation - show confirm/dispute for opponent
  if (match.status === "pending_confirmation" && isParticipant) {
    if (match.reportedBy !== userId) {
      // This is the opponent who needs to confirm
      keyboard
        .text("✅ Подтвердить", `match:confirm:${match.id}`)
        .text("❌ Оспорить", `match:dispute:${match.id}`)
        .row();
    } else {
      keyboard.text("⏳ Ожидание подтверждения...", `match:waiting:${match.id}`).row();
    }
  }

  // Admin/referee can set technical result
  if (isAdminUser && match.status !== "completed" && match.status !== "cancelled") {
    keyboard.text("⚙️ Тех. результат", `match:tech:${match.id}`).row();
  }

  // Back to bracket
  keyboard.text("📊 К сетке", `bracket:view:${match.tournamentId}`).row();

  return keyboard;
}

// === КОМАНДЫ ===

// /my_match - текущий матч игрока
matchCommands.command("my_match", async (ctx) => {
  const userId = ctx.dbUser.id;

  const activeMatches = await getPlayerActiveMatches(userId);

  if (activeMatches.length === 0) {
    await ctx.reply(
      "У вас нет активных матчей.\n\n" +
        "Если вы зарегистрированы на турнир, дождитесь его начала или своего матча в сетке."
    );
    return;
  }

  // Show first active match
  const match = activeMatches[0];
  if (!match) {
    await ctx.reply("Матч не найден");
    return;
  }

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });

  if (!tournament) {
    await ctx.reply("Турнир не найден");
    return;
  }

  const text = formatMatchCard(match, tournament);
  const keyboard = getMatchKeyboard(match, userId, tournament, isAdmin(ctx));

  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });

  // If there are more matches, show them
  if (activeMatches.length > 1) {
    await ctx.reply(
      `У вас ещё ${activeMatches.length - 1} активных матчей.\n` +
        `Используйте /my_matches для просмотра всех.`
    );
  }
});

// /bracket [id] - показать сетку турнира
matchCommands.command("bracket", async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);
  let tournamentId = args?.[0]?.trim();

  if (!tournamentId) {
    // Show list of active tournaments
    const activeTournaments = await db.query.tournaments.findMany({
      where: eq(tournaments.status, "in_progress"),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 10,
    });

    if (activeTournaments.length === 0) {
      await ctx.reply("Нет активных турниров с сеткой.");
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const t of activeTournaments) {
      keyboard.text(`📊 ${t.name}`, `bracket:view:${t.id}`).row();
    }

    await ctx.reply("Выберите турнир для просмотра сетки:", { reply_markup: keyboard });
    return;
  }

  // Show bracket for specific tournament
  await showBracket(ctx, tournamentId);
});

// === CALLBACK HANDLERS ===

// Просмотр сетки турнира
matchCommands.callbackQuery(/^bracket:view:(.+)$/, async (ctx) => {
  const tournamentId = ctx.match![1]!;
  await ctx.answerCallbackQuery();
  await showBracket(ctx, tournamentId, true);
});

// Просмотр конкретного матча
matchCommands.callbackQuery(/^match:view:(.+)$/, async (ctx) => {
  const matchId = ctx.match![1]!;
  const userId = ctx.dbUser.id;

  const match = await getMatch(matchId);
  if (!match) {
    await ctx.answerCallbackQuery({ text: "Матч не найден", show_alert: true });
    return;
  }

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });

  if (!tournament) {
    await ctx.answerCallbackQuery({ text: "Турнир не найден", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();

  const text = formatMatchCard(match, tournament);
  const keyboard = getMatchKeyboard(match, userId, tournament, isAdmin(ctx));

  await ctx.editMessageText(text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
});

// Начать матч
matchCommands.callbackQuery(/^match:start:(.+)$/, async (ctx) => {
  const matchId = ctx.match![1]!;
  const userId = ctx.dbUser.id;

  const match = await getMatch(matchId);
  if (!match) {
    await ctx.answerCallbackQuery({ text: "Матч не найден", show_alert: true });
    return;
  }

  // Check if user is participant
  if (match.player1Id !== userId && match.player2Id !== userId) {
    await ctx.answerCallbackQuery({ text: "Вы не участник этого матча", show_alert: true });
    return;
  }

  const result = await startMatch(matchId);

  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error || "Ошибка", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery("Матч начат!");

  // Refresh match view
  const updatedMatch = await getMatch(matchId);
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });

  if (updatedMatch && tournament) {
    const text = formatMatchCard(updatedMatch, tournament);
    const keyboard = getMatchKeyboard(updatedMatch, userId, tournament, isAdmin(ctx));

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
});

// Показать форму внесения результата
matchCommands.callbackQuery(/^match:report:(.+)$/, async (ctx) => {
  const matchId = ctx.match![1]!;
  const userId = ctx.dbUser.id;

  const match = await getMatch(matchId);
  if (!match) {
    await ctx.answerCallbackQuery({ text: "Матч не найден", show_alert: true });
    return;
  }

  if (match.player1Id !== userId && match.player2Id !== userId) {
    await ctx.answerCallbackQuery({ text: "Вы не участник этого матча", show_alert: true });
    return;
  }

  if (match.status !== "in_progress") {
    await ctx.answerCallbackQuery({ text: "Матч не в процессе игры", show_alert: true });
    return;
  }

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });

  if (!tournament) {
    await ctx.answerCallbackQuery({ text: "Турнир не найден", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();

  const winScore = tournament.winScore;
  const player1 = formatPlayerName(match.player1Username ?? null, match.player1Name ?? null);
  const player2 = formatPlayerName(match.player2Username ?? null, match.player2Name ?? null);

  // Generate score buttons
  const keyboard = new InlineKeyboard();

  // Winning scores for player 1 (user's perspective)
  for (let loserScore = 0; loserScore < winScore; loserScore++) {
    keyboard.text(
      `${winScore}:${loserScore}`,
      `match:score:${matchId}:${winScore}:${loserScore}`
    );
  }
  keyboard.row();

  // Winning scores for player 2
  for (let loserScore = 0; loserScore < winScore; loserScore++) {
    keyboard.text(
      `${loserScore}:${winScore}`,
      `match:score:${matchId}:${loserScore}:${winScore}`
    );
  }
  keyboard.row();

  keyboard.text("❌ Отмена", `match:view:${matchId}`);

  await ctx.editMessageText(
    `📝 *Внесение результата*\n\n` +
      `${player1} vs ${player2}\n\n` +
      `Игра до: ${winScore} побед\n\n` +
      `Выберите счёт:`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
});

// Выбор счёта
matchCommands.callbackQuery(/^match:score:(.+):(\d+):(\d+)$/, async (ctx) => {
  const matchId = ctx.match![1]!;
  const player1Score = parseInt(ctx.match![2]!, 10);
  const player2Score = parseInt(ctx.match![3]!, 10);
  const userId = ctx.dbUser.id;

  const result = await reportResult(matchId, userId, player1Score, player2Score);

  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error || "Ошибка", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery("Результат внесён! Ожидаем подтверждения от соперника.");

  // Show updated match
  const match = await getMatch(matchId);
  const tournament = match
    ? await db.query.tournaments.findFirst({
        where: eq(tournaments.id, match.tournamentId),
      })
    : null;

  if (match && tournament) {
    const text = formatMatchCard(match, tournament);
    const keyboard = getMatchKeyboard(match, userId, tournament, isAdmin(ctx));

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
});

// Подтвердить результат
matchCommands.callbackQuery(/^match:confirm:(.+)$/, async (ctx) => {
  const matchId = ctx.match![1]!;
  const userId = ctx.dbUser.id;

  const result = await confirmResult(matchId, userId);

  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error || "Ошибка", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery("Результат подтверждён!");

  // Show updated match
  const match = await getMatch(matchId);
  const tournament = match
    ? await db.query.tournaments.findFirst({
        where: eq(tournaments.id, match.tournamentId),
      })
    : null;

  if (match && tournament) {
    const text = formatMatchCard(match, tournament);
    const keyboard = getMatchKeyboard(match, userId, tournament, isAdmin(ctx));

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
});

// Оспорить результат
matchCommands.callbackQuery(/^match:dispute:(.+)$/, async (ctx) => {
  const matchId = ctx.match![1]!;
  const userId = ctx.dbUser.id;

  const result = await disputeResult(matchId, userId);

  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error || "Ошибка", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery("Результат оспорен. Обратитесь к судье турнира.");

  // Show updated match
  const match = await getMatch(matchId);
  const tournament = match
    ? await db.query.tournaments.findFirst({
        where: eq(tournaments.id, match.tournamentId),
      })
    : null;

  if (match && tournament) {
    const text =
      formatMatchCard(match, tournament) +
      "\n\n⚠️ Результат оспорен. Ожидайте решения судьи.";
    const keyboard = getMatchKeyboard(match, userId, tournament, isAdmin(ctx));

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
});

// Ожидание (заглушка)
matchCommands.callbackQuery(/^match:waiting:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({
    text: "Ожидаем подтверждения от соперника",
    show_alert: false,
  });
});

// Технический результат - меню
matchCommands.callbackQuery(/^match:tech:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery({ text: "Недостаточно прав", show_alert: true });
    return;
  }

  const matchId = ctx.match![1]!;
  const match = await getMatch(matchId);

  if (!match) {
    await ctx.answerCallbackQuery({ text: "Матч не найден", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery();

  const player1 = formatPlayerName(match.player1Username ?? null, match.player1Name ?? null);
  const player2 = formatPlayerName(match.player2Username ?? null, match.player2Name ?? null);

  const keyboard = new InlineKeyboard();

  if (match.player1Id) {
    keyboard
      .text(`✅ Победа ${player1}`, `match:tech_win:${matchId}:${match.player1Id}:walkover`)
      .row();
  }
  if (match.player2Id) {
    keyboard
      .text(`✅ Победа ${player2}`, `match:tech_win:${matchId}:${match.player2Id}:walkover`)
      .row();
  }
  keyboard.text("❌ Отмена", `match:view:${matchId}`);

  await ctx.editMessageText(
    `⚙️ *Технический результат*\n\n` +
      `Матч: ${player1} vs ${player2}\n\n` +
      `Выберите победителя:`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
});

// Установить технический результат
matchCommands.callbackQuery(/^match:tech_win:(.+):(.+):(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCallbackQuery({ text: "Недостаточно прав", show_alert: true });
    return;
  }

  const matchId = ctx.match![1]!;
  const winnerId = ctx.match![2]!;
  const reason = ctx.match![3]!;
  const userId = ctx.dbUser.id;

  const reasonText =
    reason === "no_show"
      ? "Неявка соперника"
      : reason === "walkover"
        ? "Отказ от игры"
        : reason === "forfeit"
          ? "Добровольный отказ"
          : "Техническое решение";

  const result = await setTechnicalResult(matchId, winnerId, reasonText, userId);

  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error || "Ошибка", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery("Технический результат установлен");

  // Show updated match
  const match = await getMatch(matchId);
  const tournament = match
    ? await db.query.tournaments.findFirst({
        where: eq(tournaments.id, match.tournamentId),
      })
    : null;

  if (match && tournament) {
    const text = formatMatchCard(match, tournament);
    const keyboard = getMatchKeyboard(match, userId, tournament, isAdmin(ctx));

    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
});

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

/**
 * Show tournament bracket
 */
async function showBracket(
  ctx: BotContext,
  tournamentId: string,
  isEdit: boolean = false
): Promise<void> {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    const msg = "Турнир не найден";
    if (isEdit) {
      await ctx.editMessageText(msg);
    } else {
      await ctx.reply(msg);
    }
    return;
  }

  const allMatches = await getTournamentMatches(tournamentId);
  const stats = await getMatchStats(tournamentId);

  if (allMatches.length === 0) {
    const msg = "Сетка турнира ещё не сформирована.";
    if (isEdit) {
      await ctx.editMessageText(msg);
    } else {
      await ctx.reply(msg);
    }
    return;
  }

  // Group matches by round
  const matchesByRound = new Map<number, typeof allMatches>();
  for (const match of allMatches) {
    if (!matchesByRound.has(match.round)) {
      matchesByRound.set(match.round, []);
    }
    matchesByRound.get(match.round)!.push(match);
  }

  const bracketSize = getNextPowerOfTwo(tournament.maxParticipants);
  const totalRounds = calculateRounds(bracketSize);

  let text = `📊 *Сетка турнира "${tournament.name}"*\n`;
  text += `Завершено: ${stats.completed}/${stats.total} матчей\n\n`;

  // Get all player names
  const playerIds = new Set<string>();
  for (const match of allMatches) {
    if (match.player1Id) playerIds.add(match.player1Id);
    if (match.player2Id) playerIds.add(match.player2Id);
  }

  const playerMap = new Map<string, { username: string | null; name: string | null }>();
  if (playerIds.size > 0) {
    const players = await db.query.users.findMany({
      where: inArray(users.id, Array.from(playerIds)),
    });
    for (const p of players) {
      playerMap.set(p.id, { username: p.username, name: p.name });
    }
  }

  const keyboard = new InlineKeyboard();

  // Show rounds
  const rounds = Array.from(matchesByRound.keys()).sort((a, b) => a - b);

  for (const round of rounds) {
    const roundMatches = matchesByRound.get(round)!;
    const roundName = getRoundName(round, totalRounds, tournament.format, "winners");

    text += `*${roundName}:*\n`;

    for (const match of roundMatches) {
      const p1 = match.player1Id ? playerMap.get(match.player1Id) : null;
      const p2 = match.player2Id ? playerMap.get(match.player2Id) : null;

      const player1Name = p1 ? formatPlayerName(p1.username, p1.name) : "TBD";
      const player2Name = p2 ? formatPlayerName(p2.username, p2.name) : "TBD";

      const emoji = getMatchStatusEmoji(match.status);
      let score = "";

      if (match.status === "completed" || match.status === "pending_confirmation") {
        score = ` (${match.player1Score}:${match.player2Score})`;
      }

      text += `${emoji} ${player1Name} vs ${player2Name}${score}\n`;

      // Add button for each match
      keyboard.text(`#${match.position}`, `match:view:${match.id}`);
    }
    keyboard.row();
    text += "\n";
  }

  keyboard.text("🔄 Обновить", `bracket:view:${tournamentId}`).row();

  if (isEdit) {
    await ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(text, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
}
