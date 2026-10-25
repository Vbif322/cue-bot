import { Composer, GrammyError, InlineKeyboard } from 'grammy';
import type { Api } from 'grammy';
import { eq, inArray, and } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
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
  winScoreForMatch,
  saveMatchFrame,
  deleteLastMatchFrame,
  type FrameInput,
  type MatchFrame,
} from '@/services/matchService.js';
import { sportOfDiscipline } from '@/shared/tournament/disciplines.js';
import type { Tournament } from '@/bot/@types/tournament.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import { getBracketReadModel } from '@/services/bracketReadService.js';
import { getMatchDecisionMakers } from '@/services/refereeService.js';
import {
  extendCall,
  markParticipantPresent,
  markPlayerReady,
  noShowTechnicalLoss,
  postponeCalledMatch,
} from '@/services/matchCallService.js';
import {
  notifyMatchStart,
  notifyMatchScheduled,
  notifyResultPending,
  notifyResultConfirmed,
  notifyMatchScheduleCleared,
  notifyResultDisputed,
  disputeContact,
} from '@/services/notificationService.js';

import {
  formatMatchCard,
  getMatchKeyboard,
  formatPlayerName,
  getMatchStatusEmoji,
} from '../ui/matchUI.js';
import { buildBracketView } from '../ui/bracketUI.js';
import {
  buildFrameEntryView,
  frameAt,
  isFramesDecided,
  type FrameEntryMode,
  type FrameReportState,
  type FrameSlot,
} from '../ui/frameEntryUI.js';
import {
  canManageTournament,
  canViewTournament,
  getUserRefereeTournaments,
  isAdmin,
} from '../permissions.js';
import { refreshMatchCard } from './helpers/matchCard.js';
import { TextSessionStore } from '../sessions/textSessionStore.js';
import {
  registerTextSession,
  type TextMessageContext,
  type TextSessionEndReason,
} from '../sessions/textSessionRegistry.js';
import { TEXT_SESSION_TTL_MS } from '../sessions/textSession.const.js';
import type { BotContext } from '../types.js';

export const matchCommands = new Composer<BotContext>();

/**
 * Persistent: telegram user id → match awaiting a date/time text input.
 * Set when an admin/referee presses «🗓 Назначить время»; consumed by the
 * text handler below. Переживает рестарт (хранится в Postgres).
 */
const matchScheduleState = new TextSessionStore<{ matchId: UUID }>(
  'match-schedule',
  { ttlMs: TEXT_SESSION_TTL_MS.matchSchedule },
);

/**
 * Persistent: telegram user id → snooker frame-entry prompt state
 * (`FrameReportState` — UI only; the frames are the DB draft). Переживает
 * рестарт (хранится в Postgres).
 */
const matchFrameState = new TextSessionStore<FrameReportState>(
  'match-report-frames',
  { ttlMs: TEXT_SESSION_TTL_MS.matchFrames },
);

/** Whether a tournament's discipline captures per-frame breaks (snooker only). */
function isSnooker(tournament: Tournament): boolean {
  return sportOfDiscipline(tournament.discipline) === 'snooker';
}

/** Draft frame row → the input shape `saveMatchFrame` / the report take. */
function toFrameInput(f: FrameInput): FrameInput {
  return {
    player1Points: f.player1Points,
    player2Points: f.player2Points,
    player1Break: f.player1Break ?? null,
    player2Break: f.player2Break ?? null,
  };
}

/** Re-render the frame-entry prompt in place (edit the stored prompt message). */
async function renderFramePrompt(
  api: Api,
  state: FrameReportState,
  ctx: FrameContext,
  errorLine?: string,
): Promise<void> {
  const view = buildFrameEntryView(
    state,
    ctx.frames,
    ctx.match,
    ctx.tournament,
    errorLine,
  );
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

interface FrameContext {
  match: MatchWithPlayers;
  tournament: Tournament;
  frames: MatchFrame[];
}

/** Load a frame-entry match, its tournament and draft frames, or null if missing. */
async function loadFrameContext(matchId: UUID): Promise<FrameContext | null> {
  const match = await getMatch(matchId);
  if (!match) return null;
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });
  if (!tournament) return null;
  return { match, tournament, frames: await getMatchFrames(matchId) };
}

/** Turn the frame-entry prompt message into the match card (+ an optional note). */
async function showMatchCardInPrompt(
  ctx: BotContext,
  state: FrameReportState,
  match: MatchWithPlayers,
  tournament: Tournament,
  frames: MatchFrame[],
  note?: string,
): Promise<void> {
  const canManage = await canManageTournament(ctx, tournament.id);
  try {
    await ctx.api.editMessageText(
      state.promptChatId,
      state.promptMessageId,
      formatMatchCard(match, tournament, frames) + (note ? `\n${note}` : ''),
      {
        parse_mode: 'Markdown',
        reply_markup: getMatchKeyboard(
          match,
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

/** Why the frame entry can't continue once the match has left play. */
function notInPlayNote(status: MatchWithPlayers['status']): string {
  switch (status) {
    case 'pending_confirmation':
      return 'ℹ️ Результат матча уже внесён и ожидает подтверждения — ввод по фреймам закрыт.';
    case 'completed':
      return 'ℹ️ Матч уже завершён — ввод по фреймам закрыт.';
    case 'cancelled':
      return 'ℹ️ Матч отменён — ввод по фреймам закрыт.';
    default:
      return 'ℹ️ Статус матча изменился — ввод по фреймам закрыт.';
  }
}

/**
 * The draft is editable only while the match is scheduled/in_progress. If it
 * has left play meanwhile (reported from the web, confirmed, a technical or
 * referee result…), end the session and show the current match card with a
 * note instead of the service's web-oriented «обновите страницу» error.
 * Pass `loaded` to skip the reload. Returns true when the entry was closed.
 */
async function closeFrameEntryIfNotInPlay(
  ctx: BotContext,
  userId: number,
  state: FrameReportState,
  loaded?: FrameContext | null,
): Promise<boolean> {
  const current = loaded ?? (await loadFrameContext(state.matchId));
  if (!current) return false;
  const { match, tournament, frames } = current;
  if (match.status === 'scheduled' || match.status === 'in_progress') {
    return false;
  }
  await matchFrameState.end(userId);
  await showMatchCardInPrompt(
    ctx,
    state,
    match,
    tournament,
    frames,
    notInPlayNote(match.status),
  );
  return true;
}

/**
 * Submit the snooker frame draft as the result. On success clears the session,
 * notifies the opponent, and rewrites the prompt message into the final match
 * card. On failure re-renders the prompt with the error and keeps the session
 * so the reporter can fix a frame (or leave). Invoked from «✅ Завершить».
 */
async function finalizeFrameReport(
  ctx: BotContext,
  userId: number,
  state: FrameReportState,
  loaded: FrameContext,
): Promise<void> {
  const { tournament } = loaded;
  const result = await reportResultFromFrames(
    state.matchId,
    ctx.dbUser.id,
    loaded.frames.map(toFrameInput),
  );
  if (!result.success) {
    if (await closeFrameEntryIfNotInPlay(ctx, userId, state)) return;
    await renderFramePrompt(
      ctx.api,
      state,
      loaded,
      result.error ?? 'Не удалось сохранить результат.',
    );
    return;
  }

  await matchFrameState.end(userId);
  const updatedMatch = await getMatch(state.matchId);
  const frames = await getMatchFrames(state.matchId);
  if (updatedMatch) {
    try {
      await notifyResultPending(ctx.api, updatedMatch, ctx.dbUser.id, frames);
    } catch (error) {
      console.error('Failed to send result pending notification:', error);
    }
    // Turn the prompt message into the final match card.
    await showMatchCardInPrompt(ctx, state, updatedMatch, tournament, frames);
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

  await matchScheduleState.start(ctx.from.id, { matchId: matchIdUUID }, ctx);
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

  const cleared = await setMatchSchedule(matchIdUUID, null);
  await ctx.answerCallbackQuery({ text: 'Время сброшено' });

  if (cleared.previous) {
    try {
      const tournament = await db.query.tournaments.findFirst({
        where: eq(tournaments.id, match.tournamentId),
      });
      if (tournament) {
        await notifyMatchScheduleCleared(ctx.api, match, tournament.name);
      }
    } catch (error) {
      console.error('Failed to notify cleared match schedule:', error);
    }
  }

  await refreshMatchCard(ctx, matchIdUUID);
});

/** Ввод даты/времени для назначаемого матча (из единого диспетчера текстовых сессий). */
async function handleScheduleText(
  ctx: TextMessageContext,
  state: { matchId: UUID },
): Promise<void> {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  const parsed = DateTimeHelperInstance.toDate(text);
  if (!parsed.status) {
    await ctx.reply(
      'Не удалось распознать дату. Пример: 21.06.2026 18:30. Попробуйте ещё раз или /cancel.',
    );
    return; // keep state so the user can retry
  }

  await matchScheduleState.end(userId);

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
}

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

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, match.tournamentId),
  });

  // Admin/referee may start any match (incl. one called to a table whose
  // players haven't confirmed). Players start their own match only in
  // per-match scheduling — with auto-seating the table queue starts it.
  const isParticipant =
    match.player1Id === userId || match.player2Id === userId;
  if (!(await canManageTournament(ctx, match.tournamentId))) {
    if (!isParticipant) {
      await ctx.answerCallbackQuery({
        text: 'Вы не участник этого матча',
        show_alert: true,
      });
      return;
    }
    if (tournament?.scheduleMode !== 'per_match') {
      await ctx.answerCallbackQuery({
        text: 'Матч начнётся, когда бот вызовет вас к столу',
        show_alert: true,
      });
      return;
    }
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

  await ctx.answerCallbackQuery('Матч начат!');

  if (tournament) {
    await notifyMatchStart(ctx.api, updatedMatch, tournament.name, userId);
    await refreshMatchCard(ctx, matchIdUUID);
  }
});

// Игрок подтверждает явку к столу
matchCommands.callbackQuery(/^match:ready:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchIdUUID = matchId as UUID;

  const result = await markPlayerReady(matchIdUUID, ctx.dbUser.id, ctx.api);
  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error, show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery(
    result.started ? 'Матч начат!' : 'Отмечено. Ждём соперника',
  );
  await refreshMatchCard(ctx, matchIdUUID);
});

/**
 * Shared guard for the referee's no-show actions: loads the match and checks
 * admin/referee rights, answering the callback on failure.
 */
async function loadManagedMatch(
  ctx: BotContext,
  matchId: UUID,
): Promise<MatchWithPlayers | null> {
  const match = await getMatch(matchId);
  if (!match) {
    await ctx.answerCallbackQuery({ text: 'Матч не найден', show_alert: true });
    return null;
  }
  if (!(await canManageTournament(ctx, match.tournamentId))) {
    await ctx.answerCallbackQuery({
      text: 'Недостаточно прав',
      show_alert: true,
    });
    return null;
  }
  return match;
}

// Судья: тех. поражение за неявку
matchCommands.callbackQuery(/^match:noshow:(.+):([12])$/, async (ctx) => {
  const matchId = ctx.match[1] as UUID | undefined;
  if (!matchId) return;
  const absentSlot = ctx.match[2] === '1' ? 1 : 2;
  if (!(await loadManagedMatch(ctx, matchId))) return;

  const result = await noShowTechnicalLoss(
    matchId,
    absentSlot,
    ctx.dbUser.id,
    ctx.api,
  );
  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error, show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery('Засчитано техническое поражение');
  await refreshMatchCard(ctx, matchId);
});

// Судья: отложить вызванный матч, стол уходит следующему
matchCommands.callbackQuery(/^match:postpone:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1] as UUID | undefined;
  if (!matchId) return;
  if (!(await loadManagedMatch(ctx, matchId))) return;

  const result = await postponeCalledMatch(matchId, ctx.api);
  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error, show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery('Матч отложен, стол передан следующему');
  await refreshMatchCard(ctx, matchId);
});

// Судья: подождать ещё
matchCommands.callbackQuery(/^match:extend:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1] as UUID | undefined;
  if (!matchId) return;
  if (!(await loadManagedMatch(ctx, matchId))) return;

  const result = await extendCall(matchId);
  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error, show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery('Ждём ещё 5 минут');
  await refreshMatchCard(ctx, matchId);
});

// Игрок, отмеченный отсутствующим, вернулся
matchCommands.callbackQuery(/^participant:present:(.+)$/, async (ctx) => {
  const tournamentId = ctx.match[1] as UUID | undefined;
  if (!tournamentId) return;

  const result = await markParticipantPresent(
    tournamentId,
    ctx.dbUser.id,
    ctx.api,
  );
  if (!result.success) {
    await ctx.answerCallbackQuery({ text: result.error, show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery(
    result.wasAbsent
      ? 'Отлично! Вызовем вас к столу, когда он освободится'
      : 'Вы и так в очереди',
  );
  await ctx.editMessageReplyMarkup().catch(() => undefined);
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
    // The frames are the DB draft — whatever was entered before (here, after
    // a dispute or from the web forms) is picked up, so re-entry continues.
    const savedFrames = await getMatchFrames(matchIdUUID);
    const state: FrameReportState = {
      matchId: matchIdUUID,
      promptChatId: msg.chat.id,
      promptMessageId: msg.message_id,
    };
    await matchFrameState.start(ctx.from.id, state, ctx);
    const view = buildFrameEntryView(state, savedFrames, match, tournament);
    await safeEditMessageText(ctx, {
      text: view.text,
      parse_mode: 'Markdown',
      reply_markup: view.keyboard,
    });
    return;
  }

  const winScore = winScoreForMatch(match, tournament);
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

/**
 * Снукер: ввод счёта фрейма / нового счёта фрейма / брейка текстом (из единого
 * диспетчера текстовых сессий). Каждое изменение сразу пишется в черновик
 * фреймов в БД (общий с веб-формами).
 */
async function handleFrameText(
  ctx: TextMessageContext,
  state: FrameReportState,
): Promise<void> {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  const loaded = await loadFrameContext(state.matchId);
  if (!loaded) {
    await matchFrameState.end(userId);
    await ctx.reply('Матч не найден, ввод результата отменён.');
    return;
  }
  const { match, tournament, frames } = loaded;

  // This text belongs to the frame flow — remove the user's message so the
  // editable prompt stays the last message in the chat. Errors below are shown
  // inline in the prompt (not as separate replies) to keep that single message.
  await safeDeleteMessage(ctx);
  if (await closeFrameEntryIfNotInPlay(ctx, userId, state, loaded)) return;
  const showError = (message: string) =>
    renderFramePrompt(ctx.api, state, loaded, message);
  /** Persist one frame; on success switch mode and re-render with the result. */
  const save = async (
    frameNumber: number,
    frame: FrameInput,
    nextMode: FrameEntryMode | undefined,
    note?: string,
  ): Promise<void> => {
    const saved = await saveMatchFrame(state.matchId, frameNumber, frame);
    if (!saved.success) {
      if (await closeFrameEntryIfNotInPlay(ctx, userId, state)) return;
      await showError(saved.error);
      return; // keep the mode so the user can retry
    }
    state.mode = nextMode;
    // The session ended meanwhile (/cancel, another flow) — don't revive it.
    if (!(await matchFrameState.update(userId, state))) return;
    await renderFramePrompt(
      ctx.api,
      state,
      { ...loaded, frames: saved.frames },
      note,
    );
  };

  const mode = state.mode;

  if (mode?.kind === 'pick') {
    await showError('Выберите фрейм кнопкой.');
    return;
  }

  // Awaiting a max-break value for a specific frame/slot.
  if (mode?.kind === 'break') {
    if (!/^\d+$/.test(text)) {
      await showError('Введите брейк целым числом, например 88.');
      return;
    }
    const frame = frameAt(frames, mode.frameNumber);
    if (!frame) {
      state.mode = undefined;
      if (await matchFrameState.update(userId, state)) {
        await renderFramePrompt(ctx.api, state, loaded);
      }
      return;
    }
    const value = parseInt(text, 10);
    // A break is a run of points scored within the frame, so it can't exceed
    // that player's own points in the frame.
    const framePoints =
      mode.slot === 'player1' ? frame.player1Points : frame.player2Points;
    if (value > framePoints) {
      await showError(
        `Брейк не может превышать счёт игрока в этом фрейме (${String(framePoints)}).`,
      );
      return;
    }
    await save(
      mode.frameNumber,
      {
        ...toFrameInput(frame),
        [mode.slot === 'player1' ? 'player1Break' : 'player2Break']: value,
      },
      mode.fromEdit
        ? { kind: 'edit', frameNumber: mode.frameNumber }
        : undefined,
    );
    return;
  }

  // Parse a frame line like "74-15" / "74:15" / "74 15".
  const parsed = parseFrameScoreLine(text);
  if (!parsed) {
    await showError(
      'Не удалось распознать счёт фрейма. Пример: 74-15 или 74 15.',
    );
    return;
  }
  const p1 = parsed.player1Points;
  const p2 = parsed.player2Points;
  if (p1 === p2) {
    await showError('Ничья в фрейме недопустима — счёт должен отличаться.');
    return;
  }

  // New score for an already entered frame. Breaks that still fit the new
  // points are kept; the rest are dropped (a break can't exceed the points).
  if (mode?.kind === 'edit') {
    const frame = frameAt(frames, mode.frameNumber);
    if (!frame) {
      state.mode = undefined;
      if (await matchFrameState.update(userId, state)) {
        await renderFramePrompt(ctx.api, state, loaded);
      }
      return;
    }
    const keep = (b: number | null | undefined, points: number) =>
      b != null && b <= points ? b : null;
    const updated: FrameInput = {
      player1Points: p1,
      player2Points: p2,
      player1Break: keep(frame.player1Break, p1),
      player2Break: keep(frame.player2Break, p2),
    };
    const dropped =
      (frame.player1Break != null && updated.player1Break == null) ||
      (frame.player2Break != null && updated.player2Break == null);
    await save(
      mode.frameNumber,
      updated,
      undefined,
      dropped
        ? `Фрейм ${String(mode.frameNumber)} исправлен; брейк больше нового счёта удалён.`
        : undefined,
    );
    return;
  }

  // The match is already decided — no more frames are played in snooker, and a
  // further frame would break `deriveFrameResult`'s exact-`winScore` invariant.
  // Let the reporter add breaks / press «Завершить» or fix / undo a frame.
  if (isFramesDecided(frames, match, tournament)) {
    await showError(
      'Счёт уже достигнут. Добавьте брейки и нажмите «Завершить» или исправьте / отмените фрейм.',
    );
    return;
  }

  // Once this frame decides the match, the prompt renders the finish state
  // («✅ Завершить»); the reporter submits explicitly so the deciding frame's
  // break can still be entered.
  await save(
    frames.length + 1,
    { player1Points: p1, player2Points: p2 },
    undefined,
  );
}

const FRAME_ENTRY_CLOSED = 'Ввод по фреймам закрыт';

/**
 * The frame-entry session of this user for exactly this match. A button on a
 * stale prompt (session ended, expired, or now entering another match) gets
 * undefined — it must never touch another match's session.
 */
async function getFrameSessionFor(
  userId: number,
  matchId: string,
): Promise<FrameReportState | undefined> {
  const state = await matchFrameState.get(userId);
  return state?.matchId === matchId ? state : undefined;
}

/** A button pressed on a prompt whose session is gone: show the match card instead. */
async function closeStaleFramePrompt(
  ctx: BotContext,
  matchId: string,
): Promise<void> {
  await ctx.answerCallbackQuery(FRAME_ENTRY_CLOSED);
  await refreshMatchCard(ctx, matchId as UUID);
}

/** End frame entry (/cancel or another flow took over): prompt → match card. */
async function endFrameEntry(
  ctx: BotContext,
  state: FrameReportState,
  reason: TextSessionEndReason,
): Promise<void> {
  const loaded = await loadFrameContext(state.matchId);
  if (!loaded) return;
  const note =
    reason === 'cancel'
      ? 'ℹ️ Ввод по фреймам приостановлен — фреймы сохранены, «Внести результат» продолжит.'
      : 'ℹ️ Ввод по фреймам прерван — фреймы сохранены, «Внести результат» продолжит.';
  await showMatchCardInPrompt(
    ctx,
    state,
    loaded.match,
    loaded.tournament,
    loaded.frames,
    note,
  );
}

/**
 * Shared shell of the frame-entry buttons: loads the session and the match
 * context (re-reading the draft frames), lets `apply` adjust the session, then
 * persists it and re-renders the prompt.
 */
async function handleFrameButton(
  ctx: BotContext,
  matchId: string,
  apply: (
    state: FrameReportState,
    loaded: FrameContext,
  ) => Promise<string | undefined> | string | undefined,
  answer?: string,
): Promise<void> {
  const userId = ctx.from?.id;
  const state = userId ? await getFrameSessionFor(userId, matchId) : undefined;
  if (!userId || !state) {
    await closeStaleFramePrompt(ctx, matchId);
    return;
  }
  const loaded = await loadFrameContext(state.matchId);
  if (!loaded) {
    await matchFrameState.end(userId);
    await ctx.answerCallbackQuery({
      text: 'Матч не найден, ввод результата отменён.',
      show_alert: true,
    });
    return;
  }
  if (await closeFrameEntryIfNotInPlay(ctx, userId, state, loaded)) {
    await ctx.answerCallbackQuery();
    return;
  }
  const errorLine = await apply(state, loaded);
  if (errorLine && (await closeFrameEntryIfNotInPlay(ctx, userId, state))) {
    await ctx.answerCallbackQuery();
    return;
  }
  if (!(await matchFrameState.update(userId, state))) {
    await closeStaleFramePrompt(ctx, matchId);
    return;
  }
  await ctx.answerCallbackQuery(answer);
  await renderFramePrompt(ctx.api, state, loaded, errorLine);
}

// Снукер: удалить последний фрейм из черновика.
matchCommands.callbackQuery(/^match:frame:undo:(.+)$/, async (ctx) => {
  await handleFrameButton(ctx, ctx.match[1] ?? '', async (state, loaded) => {
    state.mode = undefined;
    const res = await deleteLastMatchFrame(state.matchId);
    if (!res.success) return res.error;
    loaded.frames = res.frames;
    return undefined;
  });
});

// Снукер: выбрать фрейм для правки.
matchCommands.callbackQuery(/^match:frame:pick:(.+)$/, async (ctx) => {
  await handleFrameButton(ctx, ctx.match[1] ?? '', (state, loaded) => {
    state.mode = loaded.frames.length > 0 ? { kind: 'pick' } : undefined;
    return undefined;
  });
});

// Снукер: открыть правку фрейма N (новый счёт / брейки этого фрейма).
matchCommands.callbackQuery(/^match:frame:edit:(.+):(\d+)$/, async (ctx) => {
  const frameNumber = parseInt(ctx.match[2] ?? '', 10);
  await handleFrameButton(ctx, ctx.match[1] ?? '', (state, loaded) => {
    state.mode = frameAt(loaded.frames, frameNumber)
      ? { kind: 'edit', frameNumber }
      : undefined;
    return undefined;
  });
});

// Снукер: шаг назад (брейк → правка фрейма / ввод, правка → выбор, выбор → ввод).
matchCommands.callbackQuery(/^match:frame:back:(.+)$/, async (ctx) => {
  await handleFrameButton(ctx, ctx.match[1] ?? '', (state) => {
    const mode = state.mode;
    if (mode?.kind === 'break' && mode.fromEdit) {
      state.mode = { kind: 'edit', frameNumber: mode.frameNumber };
    } else if (mode?.kind === 'edit') {
      state.mode = { kind: 'pick' };
    } else {
      state.mode = undefined;
    }
    return undefined;
  });
});

// Снукер: запросить ввод макс. брейка — для фрейма на экране правки, иначе
// для последнего введённого.
matchCommands.callbackQuery(
  /^match:frame:break:(.+):(player1|player2)$/,
  async (ctx) => {
    const slot = ctx.match[2] as FrameSlot;
    await handleFrameButton(ctx, ctx.match[1] ?? '', (state, loaded) => {
      const fromEdit = state.mode?.kind === 'edit';
      const frameNumber =
        state.mode?.kind === 'edit'
          ? state.mode.frameNumber
          : loaded.frames.length;
      state.mode = frameAt(loaded.frames, frameNumber)
        ? { kind: 'break', frameNumber, slot, fromEdit }
        : undefined;
      return undefined;
    });
  },
);

// Снукер: завершить ввод и отправить черновик фреймов как результат.
matchCommands.callbackQuery(/^match:frame:finish:(.+)$/, async (ctx) => {
  const userId = ctx.from.id;
  const matchId = ctx.match[1] ?? '';
  const state = await getFrameSessionFor(userId, matchId);
  if (!state) {
    await closeStaleFramePrompt(ctx, matchId);
    return;
  }
  await ctx.answerCallbackQuery();
  const loaded = await loadFrameContext(state.matchId);
  if (!loaded) {
    await matchFrameState.end(userId);
    await ctx.reply('Матч не найден, ввод результата отменён.');
    return;
  }

  if (await closeFrameEntryIfNotInPlay(ctx, userId, state, loaded)) return;

  // Guard against a stale click (e.g. the last frame was undone): only submit
  // when the match is actually decided; otherwise just re-render the prompt.
  if (!isFramesDecided(loaded.frames, loaded.match, loaded.tournament)) {
    state.mode = undefined;
    if (await matchFrameState.update(userId, state)) {
      await renderFramePrompt(ctx.api, state, loaded);
    }
    return;
  }

  await finalizeFrameReport(ctx, userId, state, loaded);
});

// Снукер: выйти из ввода. Фреймы остаются в черновике — «Внести результат»
// продолжит с того же места.
matchCommands.callbackQuery(/^match:frame:cancel:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  // Only this match's session — a stale prompt must not end another match's entry.
  if (await getFrameSessionFor(ctx.from.id, matchId)) {
    await matchFrameState.end(ctx.from.id);
  }
  await ctx.answerCallbackQuery('Фреймы сохранены — можно продолжить позже');
  await refreshMatchCard(ctx, matchId as UUID);
});

// Подтвердить результат
matchCommands.callbackQuery(/^match:confirm:(.+)$/, async (ctx) => {
  const matchId = ctx.match[1];
  if (!matchId) return;
  const matchIdUUID = matchId as UUID;
  const userId = ctx.dbUser.id;

  const result = await confirmResult(
    matchIdUUID,
    userId,
    ctx.api,
    isAdmin(ctx),
  );

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

  const match = await getMatch(matchIdUUID);
  const byReferees = match
    ? (await getMatchDecisionMakers(match.tournamentId)).byReferees
    : true;
  await ctx.answerCallbackQuery(
    `Результат оспорен. Обратитесь ${disputeContact(byReferees)}.`,
  );

  // Show updated match and send notifications
  if (match) {
    // Notify both players about the dispute
    try {
      await notifyResultDisputed(ctx.api, match, userId, result.previous);
    } catch (error) {
      console.error('Failed to send result disputed notification:', error);
      // Don't fail the whole operation if notification fails
    }

    await refreshMatchCard(ctx, matchIdUUID, {
      extraText: `\n\n⚠️ Результат оспорен. Ожидайте решения ${
        byReferees ? 'судьи' : 'организатора'
      }.`,
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
    ctx.api,
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

// ============================================================================
// Текстовые сессии (единый диспетчер — src/bot/sessions/)
// ============================================================================

registerTextSession({
  store: matchScheduleState,
  name: 'назначение времени матча',
  blocking: false,
  cancelReply: 'Назначение времени отменено.',
  onText: handleScheduleText,
});

registerTextSession({
  store: matchFrameState,
  name: 'ввод результата по фреймам',
  blocking: false,
  cancelReply: 'Ввод результата приостановлен — фреймы сохранены.',
  onText: handleFrameText,
  onEnd: endFrameEntry,
});
