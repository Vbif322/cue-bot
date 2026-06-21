import { InlineKeyboard } from 'grammy';

import {
  getRoundName,
  calculateRounds,
  getNextPowerOfTwo,
} from '@/services/bracketGenerator.js';
import { clinchedUserIds } from '@/services/standingsService.js';
import type { GroupStanding } from '@/services/standingsService.js';
import type {
  BracketReadModel,
  BracketPlayer,
} from '@/services/bracketReadService.js';
import type { MatchWithPlayers } from '@/bot/@types/match.js';
import { groupLetter } from '@/utils/constants.js';

import { formatPlayerName, getMatchStatusEmoji } from './matchUI.js';

/**
 * Format a group's standings table. Players who have already CLINCHED a qualifying
 * spot (guaranteed top-`qualifiersPerGroup` regardless of remaining matches) are
 * marked with ✅. Shows wins and frame difference per player.
 */
function formatGroupStandings(
  group: GroupStanding,
  qualifiersPerGroup: number,
  totalMatches: number,
  playerMap: Map<string, BracketPlayer>,
): string {
  const clinched = clinchedUserIds(
    group.rows,
    totalMatches,
    qualifiersPerGroup,
  );
  let text = `*Группа ${groupLetter(group.groupIndex)}* (выходят ${String(qualifiersPerGroup)})\n`;
  for (const row of group.rows) {
    const parts = playerMap.get(row.userId);
    const name = parts ? formatPlayerName(parts) : 'TBD';
    const mark = clinched.has(row.userId) ? '✅' : '▫️';
    const diff =
      row.frameDiff >= 0 ? `+${String(row.frameDiff)}` : String(row.frameDiff);
    text += `${mark} ${String(row.rank)}. ${name} — ${String(row.wins)} поб., ${diff}\n`;
  }
  return text + '\n';
}

/**
 * Format a section of matches (upper or lower bracket) for display, appending a
 * per-match button to `keyboard`.
 */
function formatMatchSection(
  sectionMatches: MatchWithPlayers[],
  playerMap: Map<string, BracketPlayer>,
  tournament: { format: string; mergeRound: number },
  totalRounds: number,
  keyboard: InlineKeyboard,
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
 * Build the full bracket message text + inline keyboard from a read-model.
 * Branches by tournament format (double elimination, groups + playoff, or a
 * plain round list for single elimination / round robin).
 */
export function buildBracketView(model: BracketReadModel): {
  text: string;
  keyboard: InlineKeyboard;
} {
  const {
    tournament,
    matches: allMatches,
    stats,
    playerMap,
    totalRounds,
  } = model;

  // Group matches by round (used by the single-elim / round-robin branch).
  const matchesByRound = new Map<number, typeof allMatches>();
  for (const match of allMatches) {
    const existing = matchesByRound.get(match.round);
    if (existing) {
      existing.push(match);
    } else {
      matchesByRound.set(match.round, [match]);
    }
  }

  let text = `📊 *Сетка турнира "${tournament.name}"*\n`;
  text += `Завершено: ${String(stats.completed)}/${String(stats.total)} матчей\n\n`;

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

    const totalMatches = (tournament.participantsPerGroup ?? 1) - 1;
    for (const group of model.standings) {
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

  keyboard.text('🔄 Обновить', `bracket:view:${tournament.id}`).row();

  return { text, keyboard };
}
