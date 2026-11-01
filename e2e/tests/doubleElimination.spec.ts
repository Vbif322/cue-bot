import { getTournamentMatches } from '@/services/matchService.js';

import { expect, test } from '../fixtures.js';
import {
  playOutTournament,
  setupTournamentViaUi,
  strongerPlayerWins,
  waitForCalledMatches,
} from '../helpers/tournamentFlow.js';
import { must } from '../../test/helpers/must.js';
import { PlayerTournamentPage } from '../pages/app.js';

// A full club evening: 16 snooker players, 4 tables, random pairs after each
// round. Random mode keeps every match row from the start but drops the
// bracket pointers: a winner (or loser) is dropped into a random free slot of
// the next pool as soon as their result is confirmed.
test.use({ playerCount: 16, tableCount: 4 });

test('double elimination (random) на 16 игроков: снукер, 4 стола, до двух побед', async ({
  admin,
  players,
  venue,
}) => {
  // Lower index wins every match (strongerPlayerWins): player 0 is champion.
  const champion = must(players[0], 'players[0]');
  const { tournamentId, adminPage } = await setupTournamentViaUi({
    admin,
    players,
    venue,
    format: 'double_elimination',
    name: 'Случайная двойная E2E',
    settings: {
      sport: 'Снукер',
      discipline: '15 красных',
      winScore: 2,
      maxParticipants: 16,
      // Merge after upper round 2: the upper and lower survivors (4 + 4)
      // meet in a shared single-elimination playoff, where one loss is final.
      mergeRound: '2',
      randomAdvancement: true,
    },
  });

  // 16 players, M=2: 8+4 upper, 4+4 lower, then the 4+2+1 merge playoff
  // (stored as upper rounds 3-5).
  const atStart = await getTournamentMatches(tournamentId);
  expect(atStart).toHaveLength(27);
  expect(atStart.every((m) => m.nextMatchId === null)).toBe(true);
  // All four tables are busy from the first minute.
  const called = await waitForCalledMatches(tournamentId, 4);
  expect(new Set(called.map((m) => m.tableId)).size).toBe(4);

  const played = await playOutTournament(
    tournamentId,
    players,
    strongerPlayerWins(players),
  );
  expect(played).toHaveLength(27);
  // Every match was called to a table; every table saw play.
  expect(played.every((m) => m.tableId !== null)).toBe(true);
  expect(new Set(played.map((m) => m.tableId)).size).toBe(4);

  const all = await getTournamentMatches(tournamentId);
  expect(all.every((m) => m.status === 'completed')).toBe(true);
  // Snooker results come in by frames; the match score is the frame tally.
  expect(
    all.every(
      (m) =>
        Math.max(m.player1Score ?? 0, m.player2Score ?? 0) === 2 &&
        Math.min(m.player1Score ?? 0, m.player2Score ?? 0) < 2,
    ),
  ).toBe(true);
  const losers = all.filter((m) => m.bracketType === 'losers');
  const playoff = all.filter((m) => m.bracketType === 'winners' && m.round > 2);
  expect(losers).toHaveLength(8);
  expect(playoff).toHaveLength(7);
  const losses = (id: string): number =>
    all.filter(
      (m) => m.winnerId !== id && (m.player1Id === id || m.player2Id === id),
    ).length;
  const loserOf = (m: (typeof all)[number]): string =>
    must(m.winnerId === m.player1Id ? m.player2Id : m.player1Id, 'loser');
  // Early losers get a second life: whoever goes out in the lower bracket
  // has lost twice. In the merge playoff a loss is final, so an unbeaten
  // upper-bracket player can go out after a single defeat.
  for (const m of losers) expect(losses(loserOf(m)), m.id).toBe(2);
  for (const m of playoff)
    expect(losses(loserOf(m)), m.id).toBeLessThanOrEqual(2);
  // The playoff brings both halves together: 4 from the upper bracket (no
  // losses yet) and 4 from the lower one (one loss each).
  const playoffEntrants = playoff
    .filter((m) => m.round === 3)
    .flatMap((m) => [must(m.player1Id, 'p1'), must(m.player2Id, 'p2')]);
  const lossesBeforePlayoff = (id: string): number =>
    all.filter(
      (m) =>
        (m.bracketType === 'losers' || m.round <= 2) &&
        m.winnerId !== id &&
        (m.player1Id === id || m.player2Id === id),
    ).length;
  expect(
    playoffEntrants.map(lossesBeforePlayoff).sort((a, b) => a - b),
  ).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  // The unbeaten champion comes through the upper bracket and the playoff.
  expect(losses(champion.id)).toBe(0);
  // No pointers in random mode: the grand final is the last playoff round.
  const grandFinal = all
    .filter((m) => m.bracketType === 'winners')
    .reduce((top, m) => (m.round > top.round ? m : top));
  expect(grandFinal.round).toBe(5);
  expect(grandFinal.winnerId).toBe(champion.id);

  await adminPage.open();
  await expect(admin.page.getByText('Завершён').first()).toBeVisible();
  await new PlayerTournamentPage(champion.page, tournamentId).open();
  await expect(champion.page.getByText('Завершён').first()).toBeVisible();
});
