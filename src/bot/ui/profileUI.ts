import type { UserMatchStats } from '@/services/userStatsService.js';

/** Signed difference for a won–lost pair: `+9`, `−3`, `0`. */
export function formatSignedDiff(n: number): string {
  if (n > 0) return `+${String(n)}`;
  if (n < 0) return `−${String(-n)}`;
  return '0';
}

function wonLostLine(label: string, won: number, lost: number): string {
  return `${label}: ${String(won)}–${String(lost)} (${formatSignedDiff(won - lost)})`;
}

export function formatStats(stats: UserMatchStats): string {
  if (stats.played === 0) {
    return '📊 *Статистика*\nЕщё не сыграно ни одного матча.';
  }
  const winRate = Math.round((stats.wins / stats.played) * 100);
  const lines = [
    '📊 *Статистика*',
    `Сыграно матчей: ${String(stats.played)}`,
    `Победы: ${String(stats.wins)}`,
    `Поражения: ${String(stats.losses)}`,
    `Win-rate: ${String(winRate)}%`,
  ];
  if (stats.framesWon + stats.framesLost > 0) {
    lines.push(wonLostLine('Фреймы', stats.framesWon, stats.framesLost));
  }
  if (stats.points) {
    lines.push(wonLostLine('Очки', stats.points.won, stats.points.lost));
  }
  if (stats.maxBreak != null) {
    lines.push(`Макс. брейк: ${String(stats.maxBreak)}`);
  }
  return lines.join('\n');
}
