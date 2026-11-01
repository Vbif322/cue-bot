import { getTournamentMatches } from '@/services/matchService.js';

import { expect, test } from '../fixtures.js';
import {
  playOutTournament,
  setupTournamentViaUi,
  strongerPlayerWins,
} from '../helpers/tournamentFlow.js';

test('круговой турнир на 4 игрока: все со всеми и итоговая таблица', async ({
  admin,
  players,
  venue,
}) => {
  const { tournamentId, adminPage } = await setupTournamentViaUi({
    admin,
    players,
    venue,
    format: 'round_robin',
    name: 'Круговик E2E',
  });

  expect(await getTournamentMatches(tournamentId)).toHaveLength(6);

  // Two tables for six matches: freed tables call the next pairs in, and
  // every match is played at a table (playOutTournament only plays called
  // matches, so the queue has to keep seating pairs until the end).
  const played = await playOutTournament(
    tournamentId,
    players,
    strongerPlayerWins(players),
  );
  expect(played).toHaveLength(6);
  expect(played.every((m) => m.tableId !== null && m.calledAt !== null)).toBe(
    true,
  );
  expect(new Set(played.map((m) => m.tableId)).size).toBe(2);

  await adminPage.open('standings');
  for (const [i, player] of players.entries()) {
    const wins = players.length - 1 - i;
    // # | Игрок | М | В | П
    await expect(
      adminPage.standingsRow(player.firstName).locator('td').nth(0),
    ).toHaveText(String(i + 1));
    await expect(
      adminPage.standingsRow(player.firstName).locator('td').nth(2),
    ).toHaveText('3');
    await expect(
      adminPage.standingsRow(player.firstName).locator('td').nth(3),
    ).toHaveText(String(wins));
    await expect(
      adminPage.standingsRow(player.firstName).locator('td').nth(4),
    ).toHaveText(String(3 - wins));
  }
});
