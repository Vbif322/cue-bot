import { describe, expect, it } from 'vitest';

import { buildBracketView } from '@/bot/ui/bracketUI.js';
import type {
  BracketPlayer,
  BracketReadModel,
} from '@/services/bracketReadService.js';
import type { GroupStanding } from '@/services/standingsService.js';

const playerMap = new Map<string, BracketPlayer>([
  ['u1', { username: null, name: 'Иван', surname: null, telegramId: null }],
  ['u2', { username: null, name: 'Пётр', surname: null, telegramId: null }],
]);

const match = {
  id: 'm1',
  round: 1,
  position: 1,
  bracketType: 'winners',
  phase: 'playoff',
  groupIndex: null,
  status: 'completed',
  player1Id: 'u1',
  player2Id: 'u2',
  player1Score: 3,
  player2Score: 1,
  player1Name: 'Иван',
  player2Name: 'Пётр',
  player1Username: null,
  player2Username: null,
  player1Surname: null,
  player2Surname: null,
} as unknown as BracketReadModel['matches'][number];

const standing = {
  groupIndex: 0,
  pointsComplete: false,
  rows: [
    {
      userId: 'u1',
      seed: 1,
      played: 1,
      wins: 1,
      losses: 0,
      framesWon: 3,
      framesLost: 1,
      frameDiff: 2,
      pointsWon: 0,
      pointsLost: 0,
      pointsDiff: 0,
      rank: 1,
    },
    {
      userId: 'u2',
      seed: 2,
      played: 1,
      wins: 0,
      losses: 1,
      framesWon: 1,
      framesLost: 3,
      frameDiff: -2,
      pointsWon: 0,
      pointsLost: 0,
      pointsDiff: 0,
      rank: 2,
    },
  ],
} as unknown as GroupStanding;

function makeModel(
  format: string,
  standings: GroupStanding[],
): BracketReadModel {
  return {
    tournament: { id: 't1', name: 'Кубок', format, mergeRound: 2 },
    matches: [match],
    stats: { total: 1, completed: 1 },
    playerMap,
    totalRounds: 1,
    standings,
  } as unknown as BracketReadModel;
}

describe('buildBracketView', () => {
  it('renders the standings table above the rounds for round_robin', () => {
    const { text } = buildBracketView(makeModel('round_robin', [standing]));

    expect(text).toContain('ТАБЛИЦА');
    expect(text).toContain('1. Иван — 1 поб., +2');
    expect(text).toContain('2. Пётр — 0 поб., -2');
    // The round list still follows the table.
    const tableIndex = text.indexOf('ТАБЛИЦА');
    const roundsIndex = text.indexOf('Тур 1');
    expect(tableIndex).toBeLessThan(roundsIndex);
    // No qualification in a round robin: nobody is marked as clinched. (The ✅ of a
    // completed match lives further down, in the round list.)
    expect(text.slice(tableIndex, roundsIndex)).not.toContain('✅');
  });

  it('renders nothing extra for round_robin before the table exists', () => {
    const { text } = buildBracketView(makeModel('round_robin', []));

    expect(text).not.toContain('ТАБЛИЦА');
    expect(text).toContain('Тур 1');
  });

  it('leaves single_elimination as a plain round list', () => {
    const { text } = buildBracketView(
      makeModel('single_elimination', [standing]),
    );

    expect(text).not.toContain('ТАБЛИЦА');
    expect(text).toContain('Иван vs Пётр');
  });
});
