import { Composer, InlineKeyboard } from 'grammy';

import {
  getUserCompletedTournaments,
  getUserMatchStats,
  type UserMatchStats,
  type UserTournamentHistoryItem,
} from '@/services/userStatsService.js';
import { getUserRefereeTournaments } from '../permissions.js';
import type { BotContext } from '../types.js';
import { formatFullName } from '@/utils/messageHelpers.js';
import {
  ProfileValidationError,
  updateUserProfile,
} from '@/services/userService.js';
import { profileEditStateStore } from '../wizards/profileEdit/profileEdit.module.js';

export const profileCommands = new Composer<BotContext>();

function pluralizeTournaments(n: number): string {
  const isSingular = n % 10 === 1 && n % 100 !== 11;
  return isSingular ? 'турнире' : 'турнирах';
}

function formatProfileHeader(ctx: BotContext, refereeCount: number): string {
  const user = ctx.dbUser;
  const displayName = formatFullName(user.name, user.surname) ?? user.username;
  const usernameLine = user.username ? ` (@${user.username})` : '';

  let role: string;
  if (user.role === 'admin') {
    role = 'Админ';
  } else if (refereeCount > 0) {
    role = `Судья на ${String(refereeCount)} ${pluralizeTournaments(refereeCount)}`;
  } else {
    role = 'Игрок';
  }

  return `👤 *${displayName}*${usernameLine}\n🎭 Роль: ${role}`;
}

function formatStats(stats: UserMatchStats): string {
  if (stats.played === 0) {
    return '📊 *Статистика*\nЕщё не сыграно ни одного матча.';
  }
  const winRate = Math.round((stats.wins / stats.played) * 100);
  return (
    '📊 *Статистика*\n' +
    `Сыграно матчей: ${String(stats.played)}\n` +
    `Победы: ${String(stats.wins)}\n` +
    `Поражения: ${String(stats.losses)}\n` +
    `Win-rate: ${String(winRate)}%`
  );
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

  const [stats, history, refereeTournaments] = await Promise.all([
    getUserMatchStats(userId),
    getUserCompletedTournaments(userId, 5),
    getUserRefereeTournaments(userId),
  ]);

  const blocks: string[] = [];
  blocks.push(formatProfileHeader(ctx, refereeTournaments.length));
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

const FIELD_LABELS: Record<'name' | 'surname', string> = {
  name: 'имя',
  surname: 'фамилию',
};

profileCommands.callbackQuery(/^pe:edit:(name|surname)$/, async (ctx) => {
  const userId = ctx.from.id;
  const field = ctx.match[1] as 'name' | 'surname';
  profileEditStateStore.start(userId, field);

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `Отправьте новое значение (${FIELD_LABELS[field]}) сообщением.\n` +
      'Чтобы очистить — отправьте «-». Для отмены — /cancel.',
  );
});

profileCommands.command('cancel', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId || !profileEditStateStore.has(userId)) return;

  profileEditStateStore.clear(userId);
  await ctx.reply('Редактирование профиля отменено.');
});

profileCommands.on('message:text', async (ctx, next) => {
  const userId = ctx.from.id;

  const state = profileEditStateStore.get(userId);
  if (!state) return next();

  const raw = ctx.message.text.trim();
  const value = raw === '-' ? null : raw;

  try {
    const updated = await updateUserProfile(ctx.dbUser.id, {
      [state.field]: value,
    });
    ctx.dbUser = updated;
    profileEditStateStore.clear(userId);
    await ctx.reply('✅ Профиль обновлён.');
    await showProfile(ctx);
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      await ctx.reply(`${error.message}\nПопробуйте ещё раз или /cancel.`);
      return;
    }
    throw error;
  }
});
