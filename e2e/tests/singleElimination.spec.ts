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

test('олимпийка на 4 игрока: от создания до чемпиона', async ({
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
    format: 'single_elimination',
    name: 'Кубок клуба E2E',
  });

  // 4 players → two semi-finals, each seated at its own table at once
  // (tables are handed out right after the status flips, hence the wait).
  const semis = await waitForCalledMatches(tournamentId, 2);
  expect(semis.every((m) => m.round === 1)).toBe(true);
  expect(new Set(semis.map((m) => m.tableId)).size).toBe(2);

  const played = await playOutTournament(
    tournamentId,
    players,
    strongerPlayerWins(players),
  );
  expect(played).toHaveLength(3);

  const final = (await getTournamentMatches(tournamentId)).find(
    (m) => m.nextMatchId === null,
  );
  expect(final?.winnerId).toBe(champion.id);

  // Everyone sees the finished tournament.
  await adminPage.open();
  await expect(admin.page.getByText('Завершён').first()).toBeVisible();
  for (const player of players) {
    await new PlayerTournamentPage(player.page, tournamentId).open();
    await expect(player.page.getByText('Завершён').first()).toBeVisible();
  }
});
