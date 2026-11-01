import { getMatch, getMatchFrames } from '@/services/matchService.js';

import { expect, test } from '../fixtures.js';
import {
  playerById,
  setupTournamentViaUi,
  waitForCalledMatches,
  waitForMatchStatus,
} from '../helpers/tournamentFlow.js';
import { must } from '../../test/helpers/must.js';
import { PlayerMatchesPage } from '../pages/app.js';

// A dispute keeps the reported frames as the draft: the reporter fixes the one
// wrong frame and re-submits instead of re-entering the whole match.
test('снукер: оспоренный результат — правка одного фрейма и повторная отправка', async ({
  admin,
  players,
  venue,
}) => {
  const { tournamentId } = await setupTournamentViaUi({
    admin,
    players,
    venue,
    format: 'single_elimination',
    name: 'Спорный фрейм E2E',
    settings: { sport: 'Снукер', discipline: '15 красных', winScore: 2 },
  });

  const match = must((await waitForCalledMatches(tournamentId, 1))[0], 'match');
  const p1 = playerById(players, match.player1Id);
  const p2 = playerById(players, match.player2Id);
  const reporter = new PlayerMatchesPage(p1.page);
  const opponent = new PlayerMatchesPage(p2.page);

  await reporter.markReady(match.id);
  await opponent.markReady(match.id);
  await waitForMatchStatus(match.id, 'in_progress');

  // P1 wins 2:0, but frame 2 is reported with the wrong points.
  await reporter.reportFrames(match.id, [
    { p1: 60, p2: 25 },
    { p1: 61, p2: 30 },
  ]);
  await waitForMatchStatus(match.id, 'pending_confirmation');

  await opponent.dispute(match.id);
  await waitForMatchStatus(match.id, 'in_progress');
  expect(await getMatchFrames(match.id)).toHaveLength(2);

  // The reporter's form comes back prefilled with the draft.
  await reporter.openMatch(match.id);
  const [f1a, f1b] = reporter.frameInputs(1);
  await expect(f1a).toHaveValue('60');
  await expect(f1b).toHaveValue('25');

  await reporter.fixFrameAndSubmit(match.id, 2, { p1: 72, p2: 40 });
  await waitForMatchStatus(match.id, 'pending_confirmation');
  await opponent.confirm(match.id);
  await waitForMatchStatus(match.id, 'completed');

  const frames = await getMatchFrames(match.id);
  expect(frames.map((f) => [f.player1Points, f.player2Points])).toEqual([
    [60, 25],
    [72, 40],
  ]);
  const done = await getMatch(match.id);
  expect([done?.player1Score, done?.player2Score]).toEqual([2, 0]);
  expect(done?.winnerId).toBe(p1.id);
});
