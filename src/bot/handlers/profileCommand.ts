import { Composer, InlineKeyboard } from 'grammy';

import {
  getUserCompletedTournaments,
  getUserMatchStats,
  type UserMatchStats,
  type UserTournamentHistoryItem,
} from '@/services/userStatsService.js';
import { getUserRefereeTournaments } from '../permissions.js';
import type { BotContext } from '../types.js';

export const profileCommands = new Composer<BotContext>();

function pluralizeTournaments(n: number): string {
  const isSingular = n % 10 === 1 && n % 100 !== 11;
  return isSingular ? 'турнире' : 'турнирах';
}

function formatProfileHeader(ctx: BotContext, refereeCount: number): string {
  const user = ctx.dbUser;
  const displayName = user.name ?? user.username;
  const usernameLine = user.username ? ` (@${user.username})` : '';

  let role: string;
  if (user.role === 'admin') {
    role = 'Админ';
  } else if (refereeCount > 0) {
    role = `Судья на ${refereeCount} ${pluralizeTournaments(refereeCount)}`;
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
    `Сыграно матчей: ${stats.played}\n` +
    `Победы: ${stats.wins}\n` +
    `Поражения: ${stats.losses}\n` +
    `Win-rate: ${winRate}%`
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

  if (history.length === 0) {
    await ctx.reply(text, { parse_mode: 'Markdown' });
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const t of history) {
    keyboard.text(`📊 ${t.name}`, `bracket:view:${t.id}`).row();
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

profileCommands.command('me', (ctx) => showProfile(ctx));
