import { Composer, InlineKeyboard } from 'grammy';
import { eq, inArray, and } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { PgSessionStore } from '@/services/dialogSessionStore.js';
import { tournaments, users } from '@/db/schema.js';
import { safeEditMessageText } from '@/utils/messageHelpers.js';
import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';
import { groupLetter } from '@/utils/constants.js';
import {
  getMatch,
  getPlayerActiveMatches,
  getTournamentMatches,
  reportResult,
  confirmResult,
  disputeResult,
  setTechnicalResult,
  setMatchSchedule,
  getMatchStats,
  startMatch,
} from '@/services/matchService.js';
import {
  getRoundName,
  calculateRounds,
  getNextPowerOfTwo,
} from '@/services/bracketGenerator.js';
import { getGroupStandings } from '@/services/groupPhaseService.js';
import { clinchedUserIds } from '@/services/standingsService.js';
import type { GroupStanding } from '@/services/standingsService.js';
import {
  notifyMatchStart,
  notifyMatchScheduled,
  notifyResultPending,
  notifyResultConfirmed,
  notifyResultDisputed,
} from '@/services/notificationService.js';

import {
  formatMatchCard,
  getMatchKeyboard,
  formatPlayerName,
  getMatchStatusEmoji,
  type PlayerNameParts,
} from '../ui/matchUI.js';
import {
  canManageTournament,
  canViewTournament,
  getUserRefereeTournaments,
} from '../permissions.js';
import type { BotContext } from '../types.js';

export const matchCommands = new Composer<BotContext>();

/**
 * Persistent: telegram user id → match awaiting a date/time text input.
 * Set when an admin/referee presses «🗓 Назначить время»; consumed by the
 * text handler below. Переживает рестарт (хранится в Postgres).
 */
const matchScheduleState = new PgSessionStore<{ matchId: UUID }>(
  'match-schedule',
);

// === КОМАНДЫ ===

/**
 * Send the user their active matches grouped by tournament. Shared between
 * the /my_matches command and the reply-keyboard "🎱 Мои матчи" handler.
 */
export async function showMyMatches(ctx: BotContext): Promise<void> {
  const userId = ctx.dbUser.id;
  const activeMatches = await getPlayerActiveMatches(userId);

  if (activeMatches.length === 0) {
    await ctx.reply('У вас нет активных матчей.');
    return;
  }

  const byTournamentId = new Map<UUID, typeof activeMatches>();
  for (const m of activeMatches) {
    const tid = m.tournamentId;
    const list = byTournamentId.get(tid) ?? [];
    list.push(m);
    byTournamentId.set(tid, list);
  }

  const tournamentList = await db.query.tournaments.findMany({
    where: inArray(tournaments.id, Array.from(byTournamentId.keys())),
  });
  const tournamentMap = new Map(tournamentList.map((t) => [t.id, t]));

  let text = `🎱 *Ваши активные матчи (${String(activeMatches.length)})*\n\n`;
  const keyboard = new InlineKeyboard();

  for (const [tournamentId, matchList] of byTournamentId) {
    const tournament = tournamentMap.get(tournamentId);
    if (!tournament) continue;

    text += `*${tournament.name}*\n`;
    for (const m of matchList) {
      const p1 = formatPlayerName({
        username: m.player1Username ?? null,
        name: m.player1Name,
        surname: m.player1Surname,
        telegramId: m.player1TelegramId,
      });
      const p2 = formatPlayerName({
        username: m.player2Username ?? null,
        name: m.player2Name,
        surname: m.player2Surname,
        telegramId: m.player2TelegramId,
      });
      const emoji = getMatchStatusEmoji(m.status);
      text += `  ${emoji} #${String(m.position)} ${p1} vs ${p2}\n`;
      if (m.scheduledAt) {
        text += `     🗓 ${DateTimeHelperInstance.formatDate(m.scheduledAt)}\n`;
      }

      const isPlayer1 = m.player1Id === userId;
      const opponentPlain = formatPlayerName(
        {
          username: (isPlayer1 ? m.player2Username : m.player1Username) ?? null,
          name: isPlayer1 ? m.player2Name : m.player1Name,
          surname: isPlayer1 ? m.player2Surname : m.player1Surname,
        },
        { markdown: false },
      );
      keyboard.text(opponentPlain, `match:view:${m.id}`).row();
    }
    text += '\n';
  }

  await ctx.reply(text.trimEnd(), {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

// /my_matches - все активные матчи игрока
matchCommands.command('my_matches', (ctx) => showMyMatches(ctx));

// /referee_matches - активные матчи турниров, где пользователь судья
matchCommands.command('referee_matches', async (ctx) => {
  const userId = ctx.dbUser.id;

  const refereeTournamentIds = await getUserRefereeTournaments(userId);

  if (refereeTournamentIds.length === 0) {
    await ctx.reply('Вы не назначены судьёй ни одного турнира.');
    return;
  }

  const activeTournaments = await db.query.tournaments.findMany({
    where: and(
      inArray(tournaments.id, refereeTournamentIds),
      eq(tournaments.status, 'in_progress'),
    ),
  });

  if (activeTournaments.length === 0) {
    await ctx.reply('Нет активных турниров, где вы судья.');
    return;
  }

  let text = '⚖️ *Матчи турниров, где вы судья*\n\n';
  const keyboard = new InlineKeyboard();
  let totalMatches = 0;

  for (const tournament of activeTournaments) {
    const allMatches = await getTournamentMatches(tournament.id);
    const activeMatches = allMatches.filter((m) =>
      ['scheduled', 'in_progress', 'pending_confirmation'].includes(m.status),
    );

    if (activeMatches.length === 0) continue;

    text += `*${tournament.name}* (${String(activeMatches.length)})\n`;
    for (const m of activeMatches) {
      const p1Parts = {
        username: m.player1Username ?? null,
        name: m.player1Name,
        surname: m.player1Surname,
        telegramId: m.player1TelegramId,
      };
      const p2Parts = {
        username: m.player2Username ?? null,
        name: m.player2Name,
        surname: m.player2Surname,
        telegramId: m.player2TelegramId,
      };
      const p1 = formatPlayerName(p1Parts);
      const p2 = formatPlayerName(p2Parts);
      const p1Plain = formatPlayerName(p1Parts, { markdown: false });
      const p2Plain = formatPlayerName(p2Parts, { markdown: false });
      const emoji = getMatchStatusEmoji(m.status);
      text += `  ${emoji} #${String(m.position)} ${p1} vs ${p2}\n`;
      keyboard.text(`${p1Plain} vs ${p2Plain}`, `match:view:${m.id}`).row();
      totalMatches++;
    }
    text += '\n';
  }

  if (totalMatches === 0) {
    await ctx.reply('Нет активных матчей в ваших турнирах.');
    return;
  }

  await ctx.reply(text.trimEnd(), {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// === CALLBACK HANDLERS ===

// Просмотр сетки турнира
matchCommands.callbackQuery(/^bracket:view:(.+)$/, async (ctx) => {
  const tournamentId = ctx.match[1];
  if (!tournamentId) return;
  await ctx.answerCallbackQuery();
  await showBracket(ctx, tournamentId as UUID, true);
});

// Просмотр конкретного матча
matchCommands.callbackQuery(/^match:view:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const userId = ctx.dbUser.id;

  const match = await getMatch(matchId as UUID);
  if (!match) {
    await ctx.answerCallbackQuery({ text: 'Матч не найден', show_alert: true });
    return;
  }

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });

  // Same response for "missing" and "forbidden" so a private tournament's
  // match isn't revealed to users without access.
  if (!tournament || !(await canViewTournament(ctx, tournament))) {
    await ctx.answerCallbackQuery({
      text: 'Турнир не найден',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery();

  const text = formatMatchCard(match, tournament);
  const canManage = await canManageTournament(ctx, match.tournamentId);
  const keyboard = getMatchKeyboard(match, userId, tournament, canManage);

  await safeEditMessageText(ctx, {
    text,
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Назначить дату/время матча (поматчевое расписание)
matchCommands.callbackQuery(/^msch:set:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchIdUUID = matchId as UUID;

  const match = await getMatch(matchIdUUID);
  if (!match) {
    await ctx.answerCallbackQuery({ text: 'Матч не найден', show_alert: true });
    return;
  }

  if (!(await canManageTournament(ctx, match.tournamentId))) {
    await ctx.answerCallbackQuery({
      text: 'Недостаточно прав',
      show_alert: true,
    });
    return;
  }

  await matchScheduleState.set(ctx.from.id, { matchId: matchIdUUID });
  await ctx.answerCallbackQuery();
  await ctx.reply(
    'Введите дату и время матча (например 21.06.2026 18:30).\n\n' +
      'Чтобы оставить как есть — отправьте /cancel.',
  );
});

// Сбросить назначенное время матча
matchCommands.callbackQuery(/^msch:clear:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchIdUUID = matchId as UUID;

  const match = await getMatch(matchIdUUID);
  if (!match) {
    await ctx.answerCallbackQuery({ text: 'Матч не найден', show_alert: true });
    return;
  }

  if (!(await canManageTournament(ctx, match.tournamentId))) {
    await ctx.answerCallbackQuery({
      text: 'Недостаточно прав',
      show_alert: true,
    });
    return;
  }

  await setMatchSchedule(matchIdUUID, null);
  await ctx.answerCallbackQuery({ text: 'Время сброшено' });

  const updated = await getMatch(matchIdUUID);
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });
  if (updated && tournament) {
    await safeEditMessageText(ctx, {
      text: formatMatchCard(updated, tournament),
      parse_mode: 'Markdown',
      reply_markup: getMatchKeyboard(updated, ctx.dbUser.id, tournament, true),
    });
  }
});

// Ввод даты/времени для назначаемого матча
matchCommands.on('message:text', async (ctx, next) => {
  const userId = ctx.from.id;

  const state = await matchScheduleState.get(userId);
  if (!state) return next();

  const text = ctx.message.text.trim();
  // Let commands (e.g. /cancel) run, and stop waiting for a date.
  if (text.startsWith('/')) {
    await matchScheduleState.delete(userId);
    return next();
  }

  const parsed = DateTimeHelperInstance.toDate(text);
  if (!parsed.status) {
    await ctx.reply(
      'Не удалось распознать дату. Пример: 21.06.2026 18:30. Попробуйте ещё раз или /cancel.',
    );
    return; // keep state so the user can retry
  }

  await matchScheduleState.delete(userId);

  const result = await setMatchSchedule(state.matchId, parsed.datetime);
  if (!result.success) {
    await ctx.reply('Не удалось назначить время матча.');
    return;
  }

  const match = await getMatch(state.matchId);
  const tournament = match
    ? await db.query.tournaments.findFirst({
        where: eq(tournaments.id, match.tournamentId),
      })
    : null;

  if (match && tournament) {
    await notifyMatchScheduled(
      ctx.api,
      match,
      tournament.name,
      parsed.datetime,
    );
    await ctx.reply(formatMatchCard(match, tournament), {
      parse_mode: 'Markdown',
      reply_markup: getMatchKeyboard(match, ctx.dbUser.id, tournament, true),
    });
  } else {
    await ctx.reply(
      `Время матча назначено на ${DateTimeHelperInstance.formatDate(parsed.datetime)}.`,
    );
  }
});

// Начать матч
matchCommands.callbackQuery(/^match:start:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchIdUUID = matchId as UUID;
  const userId = ctx.dbUser.id;

  const match = await getMatch(matchIdUUID);
  if (!match) {
    await ctx.answerCallbackQuery({ text: 'Матч не найден', show_alert: true });
    return;
  }

  // Check if user is participant
  if (match.player1Id !== userId && match.player2Id !== userId) {
    await ctx.answerCallbackQuery({
      text: 'Вы не участник этого матча',
      show_alert: true,
    });
    return;
  }

  const result = await startMatch(matchIdUUID);

  if (!result.success) {
    await ctx.answerCallbackQuery({
      text: result.error ?? 'Ошибка',
      show_alert: true,
    });
    return;
  }

  const updatedMatch = { ...match, ...result.match };
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });

  await ctx.answerCallbackQuery('Матч начат!');

  if (tournament) {
    await notifyMatchStart(ctx.api, updatedMatch, tournament.name, userId);
    const text = formatMatchCard(updatedMatch, tournament);
    const canManage = await canManageTournament(ctx, updatedMatch.tournamentId);
    const keyboard = getMatchKeyboard(
      updatedMatch,
      userId,
      tournament,
      canManage,
    );

    await safeEditMessageText(ctx, {
      text,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
});

// Показать форму внесения результата
matchCommands.callbackQuery(/^match:report:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchIdUUID = matchId as UUID;
  const userId = ctx.dbUser.id;

  const match = await getMatch(matchIdUUID);
  if (!match) {
    await ctx.answerCallbackQuery({ text: 'Матч не найден', show_alert: true });
    return;
  }

  if (match.player1Id !== userId && match.player2Id !== userId) {
    await ctx.answerCallbackQuery({
      text: 'Вы не участник этого матча',
      show_alert: true,
    });
    return;
  }

  if (match.status !== 'in_progress') {
    await ctx.answerCallbackQuery({
      text: 'Матч не в процессе игры',
      show_alert: true,
    });
    return;
  }

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });

  if (!tournament) {
    await ctx.answerCallbackQuery({
      text: 'Турнир не найден',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery();

  const winScore = tournament.winScore;
  const player1 = formatPlayerName({
    username: match.player1Username ?? null,
    name: match.player1Name,
    surname: match.player1Surname,
    telegramId: match.player1TelegramId,
  });
  const player2 = formatPlayerName({
    username: match.player2Username ?? null,
    name: match.player2Name,
    surname: match.player2Surname,
    telegramId: match.player2TelegramId,
  });

  // Generate score buttons
  const keyboard = new InlineKeyboard();

  // Winning scores for player 1 (user's perspective)
  for (let loserScore = 0; loserScore < winScore; loserScore++) {
    keyboard.text(
      `${String(winScore)}:${String(loserScore)}`,
      `match:score:${matchId}:${String(winScore)}:${String(loserScore)}`,
    );
  }
  keyboard.row();

  // Winning scores for player 2
  for (let loserScore = 0; loserScore < winScore; loserScore++) {
    keyboard.text(
      `${String(loserScore)}:${String(winScore)}`,
      `match:score:${matchId}:${String(loserScore)}:${String(winScore)}`,
    );
  }
  keyboard.row();

  keyboard.text(
    `${getMatchStatusEmoji('cancelled')} Отмена`,
    `match:view:${matchId}`,
  );

  await safeEditMessageText(ctx, {
    text:
      `📝 *Внесение результата*\n\n` +
      `${player1} vs ${player2}\n\n` +
      `Игра до: ${String(winScore)} побед\n\n` +
      `Выберите счёт:`,
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Выбор счёта
matchCommands.callbackQuery(/^match:score:(.+):(\d+):(\d+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchScore2 = ctx.match[2];
  if (!matchScore2) return;
  const matchScore3 = ctx.match[3];
  if (!matchScore3) return;
  const matchIdUUID = matchId as UUID;
  const player1Score = parseInt(matchScore2, 10);
  const player2Score = parseInt(matchScore3, 10);
  const userId = ctx.dbUser.id;

  const result = await reportResult(
    matchIdUUID,
    userId,
    player1Score,
    player2Score,
  );

  if (!result.success) {
    await ctx.answerCallbackQuery({
      text: result.error ?? 'Ошибка',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery(
    'Результат внесён! Ожидаем подтверждения от соперника.',
  );

  // Get fresh match data after reportResult (includes updated scores and status)
  const updatedMatch = await getMatch(matchIdUUID);
  const tournament = updatedMatch
    ? await db.query.tournaments.findFirst({
        where: eq(tournaments.id, updatedMatch.tournamentId),
      })
    : null;
  if (updatedMatch && tournament) {
    // Send notification to opponent
    try {
      await notifyResultPending(ctx.api, updatedMatch, userId);
    } catch (error) {
      console.error('Failed to send result pending notification:', error);
      // Don't fail the whole operation if notification fails
    }

    // Show updated match UI
    const text = formatMatchCard(updatedMatch, tournament);
    const canManage = await canManageTournament(ctx, updatedMatch.tournamentId);
    const keyboard = getMatchKeyboard(
      updatedMatch,
      userId,
      tournament,
      canManage,
    );

    await safeEditMessageText(ctx, {
      text,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
});

// Подтвердить результат
matchCommands.callbackQuery(/^match:confirm:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchIdUUID = matchId as UUID;
  const userId = ctx.dbUser.id;

  const result = await confirmResult(matchIdUUID, userId);

  if (!result.success) {
    await ctx.answerCallbackQuery({
      text: result.error ?? 'Ошибка',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery('Результат подтверждён!');

  // Show updated match and send notifications
  const match = await getMatch(matchIdUUID);
  const tournament = match
    ? await db.query.tournaments.findFirst({
        where: eq(tournaments.id, match.tournamentId),
      })
    : null;

  if (match && tournament) {
    // Send notification to both players
    try {
      await notifyResultConfirmed(ctx.api, match);
    } catch (error) {
      console.error('Failed to send result confirmed notification:', error);
      // Don't fail the whole operation if notification fails
    }

    const text = formatMatchCard(match, tournament);
    const canManage = await canManageTournament(ctx, match.tournamentId);
    const keyboard = getMatchKeyboard(match, userId, tournament, canManage);

    await safeEditMessageText(ctx, {
      text,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
});

// Оспорить результат
matchCommands.callbackQuery(/^match:dispute:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchIdUUID = matchId as UUID;
  const userId = ctx.dbUser.id;

  const result = await disputeResult(matchIdUUID, userId);

  if (!result.success) {
    await ctx.answerCallbackQuery({
      text: result.error ?? 'Ошибка',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery(
    'Результат оспорен. Обратитесь к судье турнира.',
  );

  // Show updated match and send notifications
  const match = await getMatch(matchIdUUID);
  const tournament = match
    ? await db.query.tournaments.findFirst({
        where: eq(tournaments.id, match.tournamentId),
      })
    : null;

  if (match && tournament) {
    // Notify both players about the dispute
    try {
      await notifyResultDisputed(ctx.api, match, userId);
    } catch (error) {
      console.error('Failed to send result disputed notification:', error);
      // Don't fail the whole operation if notification fails
    }

    const text =
      formatMatchCard(match, tournament) +
      '\n\n⚠️ Результат оспорен. Ожидайте решения судьи.';
    const canManage = await canManageTournament(ctx, match.tournamentId);
    const keyboard = getMatchKeyboard(match, userId, tournament, canManage);

    await safeEditMessageText(ctx, {
      text,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
});

// Информационный индикатор «ожидание подтверждения соперника»
matchCommands.callbackQuery(/^match:waiting:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({
    text: 'Ожидаем подтверждения соперника...',
    show_alert: true,
  });
});

// Технический результат - меню
matchCommands.callbackQuery(/^match:tech:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchIdUUID = matchId as UUID;

  const match = await getMatch(matchIdUUID);

  if (!match) {
    await ctx.answerCallbackQuery({ text: 'Матч не найден', show_alert: true });
    return;
  }

  if (!(await canManageTournament(ctx, match.tournamentId))) {
    await ctx.answerCallbackQuery({
      text: 'Недостаточно прав',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery();

  const player1Parts = {
    username: match.player1Username ?? null,
    name: match.player1Name,
    surname: match.player1Surname,
    telegramId: match.player1TelegramId,
  };
  const player2Parts = {
    username: match.player2Username ?? null,
    name: match.player2Name,
    surname: match.player2Surname,
    telegramId: match.player2TelegramId,
  };
  const player1 = formatPlayerName(player1Parts);
  const player2 = formatPlayerName(player2Parts);
  const player1Plain = formatPlayerName(player1Parts, { markdown: false });
  const player2Plain = formatPlayerName(player2Parts, { markdown: false });

  const keyboard = new InlineKeyboard();

  if (match.player1Id) {
    keyboard
      .text(`✅ Победа ${player1Plain}`, `match:tech_win:${matchId}:1:walkover`)
      .row();
  }
  if (match.player2Id) {
    keyboard
      .text(`✅ Победа ${player2Plain}`, `match:tech_win:${matchId}:2:walkover`)
      .row();
  }
  keyboard.text(
    `${getMatchStatusEmoji('cancelled')} Отмена`,
    `match:view:${matchId}`,
  );

  await safeEditMessageText(ctx, {
    text:
      `⚙️ *Технический результат*\n\n` +
      `Матч: ${player1} vs ${player2}\n\n` +
      `Выберите победителя:`,
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Установить технический результат
matchCommands.callbackQuery(/^match:tech_win:(.+):(.+):(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const playerIndexRaw = ctx.match[2];
  if (!playerIndexRaw) return;
  const reason = ctx.match[3];
  if (!reason) return;
  const matchIdUUID = matchId as UUID;
  const playerIndex = playerIndexRaw as '1' | '2'; // "1" или "2"
  const userId = ctx.dbUser.id;

  // Получаем матч для определения winnerId по индексу
  const matchData = await getMatch(matchIdUUID);
  if (!matchData) {
    await ctx.answerCallbackQuery({
      text: 'Матч не найден',
      show_alert: true,
    });
    return;
  }

  if (!(await canManageTournament(ctx, matchData.tournamentId))) {
    await ctx.answerCallbackQuery({
      text: 'Недостаточно прав',
      show_alert: true,
    });
    return;
  }

  const winnerId =
    playerIndex === '1' ? matchData.player1Id : matchData.player2Id;
  if (!winnerId) {
    await ctx.answerCallbackQuery({
      text: 'Игрок не найден',
      show_alert: true,
    });
    return;
  }

  const reasonText =
    reason === 'no_show'
      ? 'Неявка соперника'
      : reason === 'walkover'
        ? 'Отказ от игры'
        : reason === 'forfeit'
          ? 'Добровольный отказ'
          : 'Техническое решение';

  const result = await setTechnicalResult(
    matchIdUUID,
    winnerId,
    reasonText,
    userId,
  );

  if (!result.success) {
    await ctx.answerCallbackQuery({
      text: result.error ?? 'Ошибка',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery('Технический результат установлен');

  // Show updated match
  const match = await getMatch(matchIdUUID);
  const tournament = match
    ? await db.query.tournaments.findFirst({
        where: eq(tournaments.id, match.tournamentId),
      })
    : null;

  if (match && tournament) {
    const text = formatMatchCard(match, tournament);
    const canManage = await canManageTournament(ctx, match.tournamentId);
    const keyboard = getMatchKeyboard(match, userId, tournament, canManage);

    await safeEditMessageText(ctx, {
      text,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
});

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

/**
 * Format a group's standings table. Players who have already CLINCHED a qualifying
 * spot (guaranteed top-`qualifiersPerGroup` regardless of remaining matches) are
 * marked with ✅. Shows wins and frame difference per player.
 */
function formatGroupStandings(
  group: GroupStanding,
  qualifiersPerGroup: number,
  totalMatches: number,
  playerMap: Map<string, PlayerNameParts>,
): string {
  const clinched = clinchedUserIds(group.rows, totalMatches, qualifiersPerGroup);
  let text = `*Группа ${groupLetter(group.groupIndex)}* (выходят ${String(qualifiersPerGroup)})\n`;
  for (const row of group.rows) {
    const parts = playerMap.get(row.userId);
    const name = parts ? formatPlayerName(parts) : 'TBD';
    const mark = clinched.has(row.userId) ? '✅' : '▫️';
    const diff = row.frameDiff >= 0 ? `+${String(row.frameDiff)}` : String(row.frameDiff);
    text += `${mark} ${String(row.rank)}. ${name} — ${String(row.wins)} поб., ${diff}\n`;
  }
  return text + '\n';
}

/**
 * Format a section of matches (upper or lower bracket) for display
 */
function formatMatchSection(
  sectionMatches: Awaited<ReturnType<typeof getTournamentMatches>>,
  playerMap: Map<string, PlayerNameParts>,
  tournament: { format: string; mergeRound: number },
  totalRounds: number,
  keyboard: InstanceType<typeof InlineKeyboard>,
): string {
  const byRound = new Map<number, typeof sectionMatches>();
  for (const m of sectionMatches) {
    const existing = byRound.get(m.round);
    if (existing) {
      existing.push(m);
    } else {
      byRound.set(m.round, [m]);
    }
  }

  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  let text = '';

  for (const round of rounds) {
    const roundMatches = byRound.get(round);
    if (!roundMatches) continue;
    const roundName = getRoundName(
      round,
      totalRounds,
      tournament.format,
      roundMatches[0]?.bracketType ?? 'winners',
      tournament.mergeRound,
      roundMatches[0]?.phase,
      roundMatches[0]?.groupIndex ?? undefined,
    );

    text += `*${roundName}:*\n`;

    for (const match of roundMatches) {
      const p1 = match.player1Id ? playerMap.get(match.player1Id) : null;
      const p2 = match.player2Id ? playerMap.get(match.player2Id) : null;

      const player1Name = p1 ? formatPlayerName(p1) : 'TBD';
      const player2Name = p2 ? formatPlayerName(p2) : 'TBD';

      const emoji = getMatchStatusEmoji(match.status);
      let score = '';

      if (
        match.status === 'completed' ||
        match.status === 'pending_confirmation'
      ) {
        score = ` (${String(match.player1Score ?? '?')}:${String(match.player2Score ?? '?')})`;
      }

      text += `#${String(match.position)} ${emoji} ${player1Name} vs ${player2Name}${score}\n`;
      keyboard.text(`#${String(match.position)}`, `match:view:${match.id}`);
    }
    keyboard.row();
    text += '\n';
  }

  return text;
}

/**
 * Show tournament bracket
 */
async function showBracket(
  ctx: BotContext,
  tournamentId: UUID,
  isEdit = false,
): Promise<void> {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  // Same response for "missing" and "forbidden" — don't leak a private
  // tournament's bracket to users without access.
  if (!tournament || !(await canViewTournament(ctx, tournament))) {
    const msg = 'Турнир не найден';
    if (isEdit) {
      await safeEditMessageText(ctx, { text: msg });
    } else {
      await ctx.reply(msg);
    }
    return;
  }

  const allMatches = await getTournamentMatches(tournamentId);
  const stats = await getMatchStats(tournamentId);

  if (allMatches.length === 0) {
    const msg = 'Сетка турнира ещё не сформирована.';
    if (isEdit) {
      await safeEditMessageText(ctx, { text: msg });
    } else {
      await ctx.reply(msg);
    }
    return;
  }

  // Group matches by round
  const matchesByRound = new Map<number, typeof allMatches>();
  for (const match of allMatches) {
    const existing = matchesByRound.get(match.round);
    if (existing) {
      existing.push(match);
    } else {
      matchesByRound.set(match.round, [match]);
    }
  }

  // Get all player IDs from matches
  const playerIds = new Set<UUID>();

  for (const match of allMatches) {
    if (match.player1Id) {
      playerIds.add(match.player1Id);
    }
    if (match.player2Id) {
      playerIds.add(match.player2Id);
    }
  }

  const bracketSize = getNextPowerOfTwo(playerIds.size);
  const totalRounds =
    tournament.format === 'double_elimination'
      ? calculateRounds(bracketSize) + 1
      : calculateRounds(bracketSize);

  let text = `📊 *Сетка турнира "${tournament.name}"*\n`;
  text += `Завершено: ${String(stats.completed)}/${String(stats.total)} матчей\n\n`;

  // Get all player names

  const playerMap = new Map<string, PlayerNameParts>();
  if (playerIds.size > 0) {
    const players = await db.query.users.findMany({
      where: inArray(users.id, Array.from(playerIds)),
    });
    for (const p of players) {
      playerMap.set(p.id, {
        username: p.username,
        name: p.name,
        surname: p.surname,
        telegramId: p.telegram_id,
      });
    }
  }

  const keyboard = new InlineKeyboard();

  if (tournament.format === 'double_elimination') {
    // Split matches by bracket type
    const winnersMatches = allMatches.filter(
      (m) => m.bracketType === 'winners',
    );
    const losersMatches = allMatches.filter((m) => m.bracketType === 'losers');

    text += `*═══ ВЕРХНЯЯ СЕТКА ═══*\n\n`;
    text += formatMatchSection(
      winnersMatches,
      playerMap,
      tournament,
      totalRounds,
      keyboard,
    );

    if (losersMatches.length > 0) {
      text += `*═══ НИЖНЯЯ СЕТКА ═══*\n\n`;
      text += formatMatchSection(
        losersMatches,
        playerMap,
        tournament,
        totalRounds,
        keyboard,
      );
    }
  } else if (tournament.format === 'groups_playoff') {
    // Group phase: per-group standings table + that group's matches. Playoff
    // phase (once generated): a single-elimination bracket sized by qualifiers.
    const groupMatches = allMatches.filter((m) => m.phase === 'group');
    const playoffMatches = allMatches.filter((m) => m.phase === 'playoff');
    const qpg = tournament.qualifiersPerGroup ?? 0;

    const standings = await getGroupStandings(tournamentId);
    const totalMatches = (tournament.participantsPerGroup ?? 1) - 1;
    for (const group of standings) {
      text += formatGroupStandings(group, qpg, totalMatches, playerMap);
      const groupSection = groupMatches.filter(
        (m) => m.groupIndex === group.groupIndex,
      );
      text += formatMatchSection(
        groupSection,
        playerMap,
        tournament,
        0,
        keyboard,
      );
    }

    if (playoffMatches.length > 0) {
      const playoffRounds = calculateRounds(
        getNextPowerOfTwo((tournament.groupsCount ?? 0) * qpg),
      );
      text += `*═══ ПЛЕЙ-ОФФ ═══*\n\n`;
      text += formatMatchSection(
        playoffMatches,
        playerMap,
        tournament,
        playoffRounds,
        keyboard,
      );
    }
  } else {
    // Show rounds (existing logic for single_elimination and round_robin)
    const rounds = Array.from(matchesByRound.keys()).sort((a, b) => a - b);

    for (const round of rounds) {
      const roundMatches = matchesByRound.get(round);
      if (!roundMatches) continue;
      const roundName = getRoundName(
        round,
        totalRounds,
        tournament.format,
        'winners',
        tournament.mergeRound,
        roundMatches[0]?.phase,
        roundMatches[0]?.groupIndex ?? undefined,
      );

      text += `*${roundName}:*\n`;

      for (const match of roundMatches) {
        const p1 = match.player1Id ? playerMap.get(match.player1Id) : null;
        const p2 = match.player2Id ? playerMap.get(match.player2Id) : null;

        const player1Name = p1 ? formatPlayerName(p1) : 'TBD';
        const player2Name = p2 ? formatPlayerName(p2) : 'TBD';

        const emoji = getMatchStatusEmoji(match.status);
        let score = '';

        if (
          match.status === 'completed' ||
          match.status === 'pending_confirmation'
        ) {
          score = ` (${String(match.player1Score ?? '?')}:${String(match.player2Score ?? '?')})`;
        }

        text += `${emoji} ${player1Name} vs ${player2Name}${score}\n`;

        // Add button for each match
        keyboard.text(`#${String(match.position)}`, `match:view:${match.id}`);
      }
      keyboard.row();
      text += '\n';
    }
  }

  keyboard.text('🔄 Обновить', `bracket:view:${tournamentId}`).row();

  if (isEdit) {
    await safeEditMessageText(ctx, {
      text,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}
