import { Composer, InlineKeyboard } from 'grammy';

import {
  getUserCompletedTournaments,
  getUserMatchStats,
  type UserTournamentHistoryItem,
} from '@/services/userStatsService.js';
import { formatStats } from '../ui/profileUI.js';
import { getUserRefereeTournaments } from '../permissions.js';
import { getFederationIdsOf } from '@/services/federationService.js';
import type { BotContext } from '../types.js';
import { formatFullName } from '@/utils/messageHelpers.js';
import {
  ProfileValidationError,
  updateUserProfile,
} from '@/services/userService.js';
import { profileEditStateStore } from '../wizards/profileEdit/profileEdit.module.js';
import type { ProfileEditState } from '../wizards/profileEdit/profileEdit.stateStore.js';
import {
  registerTextSession,
  type TextMessageContext,
} from '../sessions/textSessionRegistry.js';
import { hasOrganizerGrant } from '@/services/authz.js';
import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';

export const profileCommands = new Composer<BotContext>();

function pluralizeTournaments(n: number): string {
  const isSingular = n % 10 === 1 && n % 100 !== 11;
  return isSingular ? 'турнире' : 'турнирах';
}

function formatProfileHeader(
  ctx: BotContext,
  refereeCount: number,
  federationCount: number,
): string {
  const user = ctx.dbUser;
  const displayName = formatFullName(user.name, user.surname) ?? user.username;
  const usernameLine = user.username ? ` (@${user.username})` : '';

  let role: string;
  if (user.role === 'admin') {
    role = 'Админ';
  } else if (federationCount > 0 || hasOrganizerGrant(user)) {
    role = 'Организатор';
  } else if (refereeCount > 0) {
    role = `Судья на ${String(refereeCount)} ${pluralizeTournaments(refereeCount)}`;
  } else {
    role = 'Игрок';
  }

  const cityLine = user.city ? `\n📍 Город: ${user.city}` : '';
  return `👤 *${displayName}*${usernameLine}\n🎭 Роль: ${role}${cityLine}${formatGrantLine(user.organizerUntil)}`;
}

/** Срок платного права организатора (`users.organizerUntil`), если выдавалось. */
function formatGrantLine(until: Date | null): string {
  if (until === null) return '';
  const day = DateTimeHelperInstance.formatDate(until, 'DD.MM.YYYY');
  return until > new Date()
    ? `\n🏛 Право организатора до ${day}`
    : `\n🏛 Право организатора истекло ${day}`;
}

function formatHistory(history: UserTournamentHistoryItem[]): string {
  if (history.length === 0) {
    return '';
  }
  let text = '📜 *История последних турниров*\n';
  for (const t of history) {
    const emoji = t.isWinner ? '🏆' : '▫️';
    text += `${emoji} ${t.name}\n`;
  }
  return text.trimEnd();
}

export async function showProfile(ctx: BotContext): Promise<void> {
  const userId = ctx.dbUser.id;

  const [stats, history, refereeTournaments, federationIds] = await Promise.all(
    [
      getUserMatchStats(userId),
      getUserCompletedTournaments(userId, 5),
      getUserRefereeTournaments(userId),
      getFederationIdsOf(userId),
    ],
  );

  const blocks: string[] = [];
  blocks.push(
    formatProfileHeader(ctx, refereeTournaments.length, federationIds.length),
  );
  blocks.push(formatStats(stats));

  const historyBlock = formatHistory(history);
  if (historyBlock) {
    blocks.push(historyBlock);
  } else if (stats.played === 0) {
    blocks.push(
      'Откройте 📋 «Турниры», чтобы записаться на свой первый турнир.',
    );
  }

  const text = blocks.join('\n\n');

  const keyboard = new InlineKeyboard();
  keyboard
    .text('✏️ Изменить имя', 'pe:edit:name')
    .text('✏️ Изменить фамилию', 'pe:edit:surname')
    .row()
    .text(
      ctx.dbUser.city ? `📍 Город: ${ctx.dbUser.city}` : '📍 Указать город',
      'pe:edit:city',
    )
    .row();
  for (const t of history) {
    keyboard.text(`📊 ${t.name}`, `bracket:view:${t.id}`).row();
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

profileCommands.command('me', (ctx) => showProfile(ctx));

const FIELD_LABELS: Record<'name' | 'surname' | 'city', string> = {
  name: 'имя',
  surname: 'фамилию',
  city: 'город',
};

profileCommands.callbackQuery(/^pe:edit:(name|surname|city)$/, async (ctx) => {
  const userId = ctx.from.id;
  const field = ctx.match[1] as 'name' | 'surname' | 'city';
  await profileEditStateStore.start(userId, field, ctx);

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `Отправьте новое значение (${FIELD_LABELS[field]}) сообщением.\n` +
      'Чтобы очистить — отправьте «-». Для отмены — /cancel.',
  );
});

/** Новое значение поля профиля (из единого диспетчера текстовых сессий). */
async function handleProfileEditText(
  ctx: TextMessageContext,
  state: ProfileEditState,
): Promise<void> {
  const raw = ctx.message.text.trim();
  const value = raw === '-' ? null : raw;

  try {
    const updated = await updateUserProfile(ctx.dbUser.id, {
      [state.field]: value,
    });
    ctx.dbUser = updated;
    await profileEditStateStore.clear(ctx.from.id);
    await ctx.reply('✅ Профиль обновлён.');
    await showProfile(ctx);
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      await ctx.reply(`${error.message}\nПопробуйте ещё раз или /cancel.`);
      return;
    }
    throw error;
  }
}

registerTextSession({
  store: profileEditStateStore.session,
  name: 'редактирование профиля',
  blocking: true,
  callbackPrefix: 'pe:',
  cancelReply: 'Редактирование профиля отменено.',
  onText: handleProfileEditText,
});
