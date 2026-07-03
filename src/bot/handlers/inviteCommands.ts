import { Composer, InlineKeyboard } from 'grammy';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { users } from '@/db/schema.js';
import {
  acceptInvitation,
  declineInvitation,
  ensureInviteCode,
  getTournament,
  inviteParticipant,
  registerParticipant,
} from '@/services/tournamentService.js';
import type { TournamentReadModel } from '@/bot/@types/tournament.js';
import { createAndSendNotification } from '@/services/notificationService.js';
import { safeEditMessageText, escapeMarkdown } from '@/utils/messageHelpers.js';

import {
  buildTournamentKeyboard,
  buildTournamentMessage,
  getTournamentInfo,
} from '../ui/tournamentUI.js';
import { canManageTournament } from '../permissions.js';
import { registerWizard } from '../wizards/wizardRegistry.js';
import { PgSessionStore } from '@/services/dialogSessionStore.js';
import type { BotContext } from '../types.js';

export const inviteCommands = new Composer<BotContext>();

/** Persistent: telegram user id → tournament awaiting an @username to invite. */
const inviteUsernameState = new PgSessionStore<{ tournamentId: UUID }>('invite');

registerWizard({
  name: 'приглашение игрока',
  namespace: 'invite',
  callbackPrefix: 'inv:',
});

// ============================================================================
// Helpers
// ============================================================================

/** Parse a `/start` deep-link payload. Only the `join_<code>` form is known. */
export function parseStartPayload(
  payload: string | undefined,
): { kind: 'join'; code: string } | null {
  if (!payload) return null;

  const prefix = 'join_';
  if (payload.startsWith(prefix)) {
    const code = payload.slice(prefix.length);
    if (code.length > 0) return { kind: 'join', code };
  }

  return null;
}

/** (Re)render a tournament card into the current message. */
async function renderTournamentCard(
  ctx: BotContext,
  tournament: TournamentReadModel,
  edit: boolean,
): Promise<void> {
  const isAdmin = ctx.dbUser.role === 'admin';
  const info = await getTournamentInfo(tournament, ctx.dbUser.id);
  const text = buildTournamentMessage(info, isAdmin);
  const keyboard = buildTournamentKeyboard(info, isAdmin);

  if (edit) {
    await safeEditMessageText(ctx, {
      text,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

/**
 * Join flow used by the shareable invite link (`/start join_<code>`). Mirrors
 * `reg:join`: a regular user lands in `pending` (the admin still confirms,
 * since a link can be forwarded), an admin is auto-confirmed.
 */
export async function joinViaInvite(
  ctx: BotContext,
  tournament: TournamentReadModel,
): Promise<void> {
  const userId = ctx.dbUser.id;
  const isAdmin = ctx.dbUser.role === 'admin';

  const outcome = await registerParticipant(tournament.id, userId, {
    desiredStatus: isAdmin ? 'confirmed' : 'pending',
    requireOpen: true,
  });

  if (!outcome.ok) {
    const replies: Record<typeof outcome.reason, string> = {
      not_found: 'Турнир не найден.',
      registration_closed: 'Регистрация на этот турнир сейчас закрыта.',
      already_registered: 'Вы уже участвуете в этом турнире.',
      full: 'К сожалению, все места на турнир заняты.',
    };
    await ctx.reply(replies[outcome.reason]);
    if (outcome.reason === 'already_registered') {
      await renderTournamentCard(ctx, tournament, false);
    }
    return;
  }

  await ctx.reply(
    isAdmin
      ? 'Вы добавлены в турнир!'
      : 'Заявка отправлена! Ожидайте подтверждения.',
  );
  await renderTournamentCard(ctx, tournament, false);
}

function buildInviteLink(ctx: BotContext, code: string): string {
  return `https://t.me/${ctx.me.username}?start=join_${code}`;
}

// ============================================================================
// Admin: invite by @username
// ============================================================================

inviteCommands.callbackQuery(/^inv:add:(.+)$/, async (ctx) => {
  const match1 = ctx.match[1];
  if (!match1) return;
  const tournamentId = match1 as UUID;

  if (!(await canManageTournament(ctx, tournamentId))) {
    await ctx.answerCallbackQuery({
      text: 'Недостаточно прав',
      show_alert: true,
    });
    return;
  }

  await inviteUsernameState.set(ctx.from.id, { tournamentId });
  await ctx.answerCallbackQuery();
  await ctx.reply(
    'Отправьте @username игрока, которого хотите пригласить.\n\n' +
      'Чтобы отменить — /cancel',
  );
});

/** /cancel while an invite username is awaited; otherwise pass through. */
inviteCommands.command('cancel', async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId != null && (await inviteUsernameState.delete(userId))) {
    await ctx.reply('Приглашение отменено.');
    return;
  }
  return next();
});

inviteCommands.on('message:text', async (ctx, next) => {
  const userId = ctx.from.id;

  const state = await inviteUsernameState.get(userId);
  if (!state) return next();

  const text = ctx.message.text.trim();
  // Let commands (e.g. /cancel) be handled by their own handlers.
  if (text.startsWith('/')) return next();

  // One-shot: consume the state now; the admin re-presses the button to retry.
  await inviteUsernameState.delete(userId);

  const handle = text.replace(/^@/, '').trim();
  if (!handle) {
    await ctx.reply('Пустой username. Нажмите «Пригласить игрока» ещё раз.');
    return;
  }

  const tournament = await getTournament(state.tournamentId);
  if (!tournament) {
    await ctx.reply('Турнир не найден.');
    return;
  }

  const target = await db.query.users.findFirst({
    where: and(eq(users.username, handle), isNotNull(users.telegram_id)),
  });

  if (!target) {
    const code = await ensureInviteCode(state.tournamentId);
    await ctx.reply(
      `Пользователь @${handle} не найден в боте — он должен сначала запустить бота.\n\n` +
        `Поделитесь ссылкой-приглашением:\n${buildInviteLink(ctx, code)}`,
    );
    return;
  }

  const outcome = await inviteParticipant(state.tournamentId, target.id);

  if (!outcome.ok) {
    const replies: Record<typeof outcome.reason, string> = {
      not_found: 'Турнир не найден.',
      already_participant: `@${handle} уже участвует или уже приглашён в этот турнир.`,
      full: 'В турнире не осталось свободных мест.',
    };
    await ctx.reply(replies[outcome.reason]);
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('✅ Принять', `inv:accept:${state.tournamentId}`)
    .text('❌ Отклонить', `inv:decline:${state.tournamentId}`);

  await createAndSendNotification(
    ctx.api,
    {
      userId: target.id,
      type: 'tournament_invitation',
      title: 'Приглашение на турнир',
      message:
        `Вас пригласили в турнир «${escapeMarkdown(tournament.name)}».\n\n` +
        'Откройте «Мои турниры», чтобы принять или отклонить приглашение.',
      tournamentId: state.tournamentId,
    },
    keyboard,
  );

  await ctx.reply(`Приглашение отправлено: @${handle}`);
});

// ============================================================================
// Invitee: accept / decline
// ============================================================================

inviteCommands.callbackQuery(/^inv:accept:(.+)$/, async (ctx) => {
  const match1 = ctx.match[1];
  if (!match1) return;
  const tournamentId = match1 as UUID;
  const userId = ctx.dbUser.id;

  const outcome = await acceptInvitation(tournamentId, userId);

  if (!outcome.ok) {
    const alerts: Record<typeof outcome.reason, string> = {
      not_found: 'Приглашение не найдено',
      not_invited: 'Приглашение не найдено',
      full: 'В турнире не осталось свободных мест',
    };
    await ctx.answerCallbackQuery({
      text: alerts[outcome.reason],
      show_alert: true,
    });
    return;
  }

  const tournament = await getTournament(tournamentId);
  if (!tournament) {
    await ctx.answerCallbackQuery({
      text: 'Приглашение не найдено',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery({ text: 'Вы в турнире!' });
  await renderTournamentCard(ctx, tournament, true);
});

inviteCommands.callbackQuery(/^inv:decline:(.+)$/, async (ctx) => {
  const match1 = ctx.match[1];
  if (!match1) return;
  const tournamentId = match1 as UUID;
  const userId = ctx.dbUser.id;

  const outcome = await declineInvitation(tournamentId, userId);

  if (!outcome.ok) {
    await ctx.answerCallbackQuery({
      text: 'Приглашение не найдено',
      show_alert: true,
    });
    return;
  }

  const tournament = await getTournament(tournamentId);
  if (!tournament) {
    await ctx.answerCallbackQuery({
      text: 'Приглашение не найдено',
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery({ text: 'Приглашение отклонено' });
  await renderTournamentCard(ctx, tournament, true);
});

// ============================================================================
// Admin: shareable invite link
// ============================================================================

inviteCommands.callbackQuery(/^inv:link:(.+)$/, async (ctx) => {
  const match1 = ctx.match[1];
  if (!match1) return;
  const tournamentId = match1 as UUID;

  if (!(await canManageTournament(ctx, tournamentId))) {
    await ctx.answerCallbackQuery({
      text: 'Недостаточно прав',
      show_alert: true,
    });
    return;
  }

  const code = await ensureInviteCode(tournamentId);
  await ctx.answerCallbackQuery();
  await ctx.reply(
    'Ссылка-приглашение (любой, у кого есть ссылка, может присоединиться):\n' +
      buildInviteLink(ctx, code),
  );
});
