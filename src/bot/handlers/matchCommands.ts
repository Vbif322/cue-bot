import { Composer, GrammyError, InlineKeyboard } from 'grammy';
import type { Api } from 'grammy';
import { eq, inArray, and } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { PgSessionStore } from '@/services/dialogSessionStore.js';
import { tournaments } from '@/db/schema.js';
import {
  safeEditMessageText,
  safeDeleteMessage,
} from '@/utils/messageHelpers.js';
import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';
import {
  getMatch,
  getMatchFrames,
  getPlayerActiveMatches,
  getTournamentMatches,
  reportResult,
  reportResultFromFrames,
  parseFrameScoreLine,
  confirmResult,
  disputeResult,
  setTechnicalResult,
  setMatchSchedule,
  startMatch,
  type FrameInput,
} from '@/services/matchService.js';
import { sportOfDiscipline } from '@/shared/tournament/disciplines.js';
import type { Tournament } from '@/bot/@types/tournament.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import { getBracketReadModel } from '@/services/bracketReadService.js';
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
} from '../ui/matchUI.js';
import { buildBracketView } from '../ui/bracketUI.js';
import {
  canManageTournament,
  canViewTournament,
  getUserRefereeTournaments,
  isAdmin,
} from '../permissions.js';
import { refreshMatchCard } from './helpers/matchCard.js';
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

/**
 * Persistent: telegram user id → in-progress snooker frame-by-frame entry.
 * `frames` accumulates as the reporter types each frame; `awaitingBreak` marks
 * that the next numeric message is a max-break value for a given frame/slot.
 * `promptChatId`/`promptMessageId` locate the editable prompt message so text
 * input can re-render it in place. Переживает рестарт (хранится в Postgres).
 */
interface FrameReportState {
  matchId: UUID;
  frames: FrameInput[];
  awaitingBreak?:
    | { frameIndex: number; slot: 'player1' | 'player2' }
    | undefined;
  promptChatId: number;
  promptMessageId: number;
}
const matchFrameState = new PgSessionStore<FrameReportState>(
  'match-report-frames',
);

/** Whether a tournament's discipline captures per-frame breaks (snooker only). */
function isSnooker(tournament: Tournament): boolean {
  return sportOfDiscipline(tournament.discipline) === 'snooker';
}

/** Frames-won counts derived from an in-progress frame list. */
function tallyFrames(frames: FrameInput[]): { p1: number; p2: number } {
  let p1 = 0;
  let p2 = 0;
  for (const f of frames) {
    if (f.player1Points > f.player2Points) p1++;
    else if (f.player2Points > f.player1Points) p2++;
  }
  return { p1, p2 };
}

/**
 * Build the frame-entry prompt (message text + control keyboard) from the
 * current accumulator. Pure — the caller edits the prompt message with it.
 */
function buildFrameEntryView(
  state: FrameReportState,
  match: MatchWithPlayers,
  tournament: Tournament,
  errorLine?: string,
): { text: string; keyboard: InlineKeyboard } {
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
  const { p1, p2 } = tallyFrames(state.frames);

  let text = `📝 *Внесение результата (по фреймам)*\n\n`;
  text += `${player1} vs ${player2}\n`;
  text += `Игра до: ${String(tournament.winScore)} побед\n\n`;
  if (errorLine) text += `⚠️ ${errorLine}\n\n`;

  if (state.frames.length > 0) {
    text += `*Фреймы:*\n`;
    state.frames.forEach((f, i) => {
      let line = `${String(i + 1)}) ${String(f.player1Points)} : ${String(f.player2Points)}`;
      const breaks: string[] = [];
      if (f.player1Break != null)
        breaks.push(`P1 брейк ${String(f.player1Break)}`);
      if (f.player2Break != null)
        breaks.push(`P2 брейк ${String(f.player2Break)}`);
      if (breaks.length) line += `  🎯 ${breaks.join(', ')}`;
      text += `${line}\n`;
    });
    text += `Счёт по фреймам: ${String(p1)} : ${String(p2)}\n\n`;
  }

  const keyboard = new InlineKeyboard();
  if (state.awaitingBreak) {
    // Non-linked name here: a tg:// link wrapped in bold renders as an odd
    // clickable label inside a plain instruction.
    const whoParts =
      state.awaitingBreak.slot === 'player1' ? player1Parts : player2Parts;
    const who = formatPlayerName(whoParts, { link: false });
    text += `Введите макс. брейк для *${who}* (фрейм ${String(state.awaitingBreak.frameIndex + 1)}) числом:`;
  } else {
    const decided = Math.max(p1, p2) >= tournament.winScore;
    if (decided) {
      text += `Счёт достигнут (${String(p1)} : ${String(p2)}). Добавьте макс. брейки при необходимости и нажмите «Завершить».`;
      keyboard
        .text('✅ Завершить', `match:frame:finish:${state.matchId}`)
        .row();
    } else {
      text += `Отправьте счёт следующего фрейма сообщением, например \`74-15\` или \`74 15\``;
    }
    if (state.frames.length > 0) {
      keyboard
        .text('↩️ Отменить фрейм', `match:frame:undo:${state.matchId}`)
        .row();
      if (isSnooker(tournament)) {
        keyboard
          .text('🎯 Брейк P1', `match:frame:break:${state.matchId}:player1`)
          .text('🎯 Брейк P2', `match:frame:break:${state.matchId}:player2`)
          .row();
      }
    }
  }
  keyboard.text('❌ Отмена', `match:frame:cancel:${state.matchId}`);

  return { text, keyboard };
}

/** Re-render the frame-entry prompt in place (edit the stored prompt message). */
async function renderFramePrompt(
  api: Api,
  state: FrameReportState,
  match: MatchWithPlayers,
  tournament: Tournament,
  errorLine?: string,
): Promise<void> {
  const view = buildFrameEntryView(state, match, tournament, errorLine);
  try {
    await api.editMessageText(
      state.promptChatId,
      state.promptMessageId,
      view.text,
      { parse_mode: 'Markdown', reply_markup: view.keyboard },
    );
  } catch (error) {
    // Ignore the "message is not modified" no-op; propagate anything else.
    if (
      !(
        error instanceof GrammyError &&
        error.description.includes('message is not modified')
      )
    ) {
      throw error;
    }
  }
}

/** Load a frame-entry match + its tournament, or null if either is missing. */
async function loadFrameContext(
  matchId: UUID,
): Promise<{ match: MatchWithPlayers; tournament: Tournament } | null> {
  const match = await getMatch(matchId);
  if (!match) return null;
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });
  if (!tournament) return null;
  return { match, tournament };
}

/**
 * Submit an accumulated snooker frame report. On success clears the session,
 * notifies the opponent, and rewrites the prompt message into the final match
 * card. On failure re-renders the prompt with the error and keeps the session
 * so the reporter can retry (or cancel). Invoked from the «✅ Завершить» button.
 */
async function finalizeFrameReport(
  ctx: BotContext,
  userId: number,
  state: FrameReportState,
  match: MatchWithPlayers,
  tournament: Tournament,
): Promise<void> {
  const result = await reportResultFromFrames(
    state.matchId,
    ctx.dbUser.id,
    state.frames,
  );
  if (!result.success) {
    await renderFramePrompt(
      ctx.api,
      state,
      match,
      tournament,
      result.error ?? 'Не удалось сохранить результат.',
    );
    return;
  }

  await matchFrameState.delete(userId);
  const updatedMatch = await getMatch(state.matchId);
  const frames = await getMatchFrames(state.matchId);
  if (updatedMatch) {
    try {
      await notifyResultPending(ctx.api, updatedMatch, ctx.dbUser.id, frames);
    } catch (error) {
      console.error('Failed to send result pending notification:', error);
    }
    // Turn the prompt message into the final match card.
    const canManage = await canManageTournament(ctx, tournament.id);
    try {
      await ctx.api.editMessageText(
        state.promptChatId,
        state.promptMessageId,
        formatMatchCard(updatedMatch, tournament, frames),
        {
          parse_mode: 'Markdown',
          reply_markup: getMatchKeyboard(
            updatedMatch,
            ctx.dbUser.id,
            tournament,
            canManage,
          ),
        },
      );
    } catch (error) {
      if (!(error instanceof GrammyError)) throw error;
    }
  }
  await ctx.reply('Результат внесён! Ожидаем подтверждения от соперника.');
}

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

  await refreshMatchCard(ctx, matchId as UUID);
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

  await refreshMatchCard(ctx, matchIdUUID);
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
    await refreshMatchCard(ctx, matchIdUUID);
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

  // Snooker: enter the result frame-by-frame via text; other disciplines keep
  // the one-tap preset-scoreline picker below.
  if (isSnooker(tournament)) {
    const msg = ctx.callbackQuery.message;
    if (!msg) return;
    const state: FrameReportState = {
      matchId: matchIdUUID,
      frames: [],
      promptChatId: msg.chat.id,
      promptMessageId: msg.message_id,
    };
    await matchFrameState.set(ctx.from.id, state);
    const view = buildFrameEntryView(state, match, tournament);
    await safeEditMessageText(ctx, {
      text: view.text,
      parse_mode: 'Markdown',
      reply_markup: view.keyboard,
    });
    return;
  }

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
  if (updatedMatch) {
    // Send notification to opponent
    try {
      await notifyResultPending(ctx.api, updatedMatch, userId);
    } catch (error) {
      console.error('Failed to send result pending notification:', error);
      // Don't fail the whole operation if notification fails
    }

    // Show updated match UI
    await refreshMatchCard(ctx, matchIdUUID);
  }
});

// Снукер: ввод счёта очередного фрейма / значения макс. брейка текстом.
matchCommands.on('message:text', async (ctx, next) => {
  const userId = ctx.from.id;
  const state = await matchFrameState.get(userId);
  if (!state) return next();

  const text = ctx.message.text.trim();
  // Let commands (e.g. /cancel) run and stop the frame entry.
  if (text.startsWith('/')) {
    await matchFrameState.delete(userId);
    return next();
  }

  const loaded = await loadFrameContext(state.matchId);
  if (!loaded) {
    await matchFrameState.delete(userId);
    await ctx.reply('Матч не найден, ввод результата отменён.');
    return;
  }
  const { match, tournament } = loaded;

  // This text belongs to the frame flow — remove the user's message so the
  // editable prompt stays the last message in the chat. Errors below are shown
  // inline in the prompt (not as separate replies) to keep that single message.
  await safeDeleteMessage(ctx);

  // Awaiting a max-break value for a specific frame/slot.
  if (state.awaitingBreak) {
    if (!/^\d+$/.test(text)) {
      await renderFramePrompt(
        ctx.api,
        state,
        match,
        tournament,
        'Введите брейк целым числом, например 88.',
      );
      return; // keep state so the user can retry
    }
    const frame = state.frames[state.awaitingBreak.frameIndex];
    if (frame) {
      const value = parseInt(text, 10);
      // A break is a run of points scored within the frame, so it can't exceed
      // that player's own points in the frame.
      const framePoints =
        state.awaitingBreak.slot === 'player1'
          ? frame.player1Points
          : frame.player2Points;
      if (value > framePoints) {
        await renderFramePrompt(
          ctx.api,
          state,
          match,
          tournament,
          `Брейк не может превышать счёт игрока в этом фрейме (${String(framePoints)}).`,
        );
        return; // keep awaitingBreak so the user can retry
      }
      if (state.awaitingBreak.slot === 'player1') frame.player1Break = value;
      else frame.player2Break = value;
    }
    state.awaitingBreak = undefined;
    await matchFrameState.set(userId, state);
    await renderFramePrompt(ctx.api, state, match, tournament);
    return;
  }

  // Parse a frame line like "74-15" / "74:15" / "74 15".
  const parsed = parseFrameScoreLine(text);
  if (!parsed) {
    await renderFramePrompt(
      ctx.api,
      state,
      match,
      tournament,
      'Не удалось распознать счёт фрейма. Пример: 74-15 или 74 15.',
    );
    return; // keep state
  }
  const p1 = parsed.player1Points;
  const p2 = parsed.player2Points;
  if (p1 === p2) {
    await renderFramePrompt(
      ctx.api,
      state,
      match,
      tournament,
      'Ничья в фрейме недопустима — счёт должен отличаться.',
    );
    return;
  }
  // The match is already decided — no more frames are played in snooker, and a
  // further frame would break `deriveFrameResult`'s exact-`winScore` invariant.
  // Let the reporter add breaks / press «Завершить» or undo the last frame.
  const decided = tallyFrames(state.frames);
  if (Math.max(decided.p1, decided.p2) >= tournament.winScore) {
    await renderFramePrompt(
      ctx.api,
      state,
      match,
      tournament,
      'Счёт уже достигнут. Добавьте брейки и нажмите «Завершить» или отмените последний фрейм.',
    );
    return;
  }

  state.frames.push({ player1Points: p1, player2Points: p2 });
  await matchFrameState.set(userId, state);
  // Once this frame decides the match, the prompt renders the finish state
  // («✅ Завершить»); the reporter submits explicitly so the deciding frame's
  // break can still be entered.
  await renderFramePrompt(ctx.api, state, match, tournament);
});

// Снукер: отменить последний введённый фрейм.
matchCommands.callbackQuery(/^match:frame:undo:(.+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const state = await matchFrameState.get(userId);
  if (!state) {
    await ctx.answerCallbackQuery();
    return;
  }
  state.frames.pop();
  state.awaitingBreak = undefined;
  await matchFrameState.set(userId, state);
  await ctx.answerCallbackQuery('Последний фрейм удалён');
  const loaded = await loadFrameContext(state.matchId);
  if (loaded) {
    await renderFramePrompt(ctx.api, state, loaded.match, loaded.tournament);
  }
});

// Снукер: завершить ввод и отправить результат по фреймам.
matchCommands.callbackQuery(/^match:frame:finish:(.+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const state = await matchFrameState.get(userId);
  if (!state) {
    await ctx.answerCallbackQuery();
    return;
  }
  await ctx.answerCallbackQuery();
  const loaded = await loadFrameContext(state.matchId);
  if (!loaded) {
    await matchFrameState.delete(userId);
    await ctx.reply('Матч не найден, ввод результата отменён.');
    return;
  }
  const { match, tournament } = loaded;

  // Guard against a stale click (e.g. the last frame was undone): only submit
  // when the match is actually decided; otherwise just re-render the prompt.
  const { p1, p2 } = tallyFrames(state.frames);
  if (Math.max(p1, p2) < tournament.winScore) {
    await renderFramePrompt(ctx.api, state, match, tournament);
    return;
  }

  await finalizeFrameReport(ctx, userId, state, match, tournament);
});

// Снукер: запросить ввод макс. брейка для последнего фрейма.
matchCommands.callbackQuery(
  /^match:frame:break:(.+):(player1|player2)$/,
  async (ctx) => {
    const userId = ctx.from.id;
    const state = await matchFrameState.get(userId);
    if (!state || state.frames.length === 0) {
      await ctx.answerCallbackQuery();
      return;
    }
    const slot = ctx.match[2] as 'player1' | 'player2';
    state.awaitingBreak = { frameIndex: state.frames.length - 1, slot };
    await matchFrameState.set(userId, state);
    await ctx.answerCallbackQuery();
    const loaded = await loadFrameContext(state.matchId);
    if (loaded) {
      await renderFramePrompt(ctx.api, state, loaded.match, loaded.tournament);
    }
  },
);

// Снукер: отменить ввод результата по фреймам.
matchCommands.callbackQuery(/^match:frame:cancel:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  await matchFrameState.delete(ctx.from.id);
  await ctx.answerCallbackQuery('Ввод отменён');
  await refreshMatchCard(ctx, matchId as UUID);
});

// Подтвердить результат
matchCommands.callbackQuery(/^match:confirm:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchIdUUID = matchId as UUID;
  const userId = ctx.dbUser.id;

  const result = await confirmResult(matchIdUUID, userId, undefined, isAdmin(ctx));

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
  if (match) {
    // Send notification to both players
    try {
      await notifyResultConfirmed(ctx.api, match);
    } catch (error) {
      console.error('Failed to send result confirmed notification:', error);
      // Don't fail the whole operation if notification fails
    }

    await refreshMatchCard(ctx, matchIdUUID);
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
  if (match) {
    // Notify both players about the dispute
    try {
      await notifyResultDisputed(ctx.api, match, userId);
    } catch (error) {
      console.error('Failed to send result disputed notification:', error);
      // Don't fail the whole operation if notification fails
    }

    await refreshMatchCard(ctx, matchIdUUID, {
      extraText: '\n\n⚠️ Результат оспорен. Ожидайте решения судьи.',
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
  await refreshMatchCard(ctx, matchIdUUID);
});

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

/**
 * Show tournament bracket
 */
async function showBracket(
  ctx: BotContext,
  tournamentId: UUID,
  isEdit = false,
): Promise<void> {
  const model = await getBracketReadModel(tournamentId);

  // Same response for "missing" and "forbidden" — don't leak a private
  // tournament's bracket to users without access.
  if (!model || !(await canViewTournament(ctx, model.tournament))) {
    const msg = 'Турнир не найден';
    if (isEdit) {
      await safeEditMessageText(ctx, { text: msg });
    } else {
      await ctx.reply(msg);
    }
    return;
  }

  if (model.matches.length === 0) {
    const msg = 'Сетка турнира ещё не сформирована.';
    if (isEdit) {
      await safeEditMessageText(ctx, { text: msg });
    } else {
      await ctx.reply(msg);
    }
    return;
  }

  const { text, keyboard } = buildBracketView(model);

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
