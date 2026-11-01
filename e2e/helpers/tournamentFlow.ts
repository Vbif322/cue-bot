import type { UUID } from 'crypto';

import { expect } from '@playwright/test';

import type { Match } from '@/bot/@types/match.js';
import {
  getMatch,
  getTournamentMatches,
  winScoreForMatch,
} from '@/services/matchService.js';
import { getTournament } from '@/services/tournamentService.js';

import type { Admin, Player, Venue } from '../fixtures.js';
import {
  AdminTournamentPage,
  AdminTournamentsPage,
  type NewTournament,
} from '../pages/admin.js';
import { PlayerMatchesPage, PlayerTournamentPage } from '../pages/app.js';

/*
 * Every action goes through the UI. The DB is read only as an oracle: which
 * matches are on, who plays them and whether a step has landed.
 */

export const FORMAT_LABELS = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  round_robin: 'Round Robin',
} as const;

export type E2EFormat = keyof typeof FORMAT_LABELS;

/**
 * The organiser's half of a tournament day: create (pool «Восьмёрка» unless
 * overridden, race to 2, all venue tables) → open registration → every player
 * signs up from their own session → confirm them all → close registration →
 * start.
 */
export async function setupTournamentViaUi(opts: {
  admin: Admin;
  players: Player[];
  venue: Venue;
  format: E2EFormat;
  name: string;
  /** Extra form settings, e.g. the discipline or the DE merge round. */
  settings?: Partial<
    Pick<
      NewTournament,
      | 'sport'
      | 'discipline'
      | 'winScore'
      | 'maxParticipants'
      | 'mergeRound'
      | 'randomAdvancement'
    >
  >;
}): Promise<{ tournamentId: UUID; adminPage: AdminTournamentPage }> {
  const { admin, players, venue, format, name, settings } = opts;

  const tournamentId = await new AdminTournamentsPage(
    admin.page,
  ).createTournament({
    name,
    venue: venue.name,
    sport: 'Пул',
    discipline: 'Восьмёрка',
    format: FORMAT_LABELS[format],
    winScore: 2,
    tables: venue.tableNames,
    ...settings,
  });

  const adminPage = new AdminTournamentPage(admin.page, tournamentId);
  await adminPage.advance('Открыть регистрацию');

  for (const player of players) {
    await new PlayerTournamentPage(player.page, tournamentId).register();
  }

  await adminPage.open('participants');
  for (const player of players) {
    await adminPage.confirmParticipant(player.username);
  }
  await adminPage.advance('Закрыть регистрацию');
  await adminPage.advance('Запустить турнир');

  await expect
    .poll(async () => (await getTournament(tournamentId))?.status)
    .toBe('in_progress');

  return { tournamentId, adminPage };
}

/**
 * Seated at a table and called in — the same condition the player's match
 * modal uses to show «Я у стола».
 */
function isCalled(m: Match): boolean {
  return m.tableId !== null && m.calledAt !== null;
}

/** Called matches that are still open (checking in or being played). */
function calledOpen(matches: Match[]): Match[] {
  return matches.filter(
    (m) =>
      m.player1Id !== null &&
      m.player2Id !== null &&
      isCalled(m) &&
      (m.status === 'scheduled' || m.status === 'in_progress'),
  );
}

/**
 * Tables are handed out after the tournament status (and after each result)
 * is committed, so a test that wants to see who was called has to wait for it.
 */
export async function waitForCalledMatches(
  tournamentId: UUID,
  count: number,
): Promise<Match[]> {
  let called: Match[] = [];
  await expect
    .poll(
      async () => {
        called = calledOpen(await getTournamentMatches(tournamentId));
        return called.length;
      },
      { message: `${String(count)} called matches in ${tournamentId}` },
    )
    .toBeGreaterThanOrEqual(count);
  return called;
}

export async function waitForMatchStatus(
  matchId: UUID,
  status: Match['status'],
): Promise<void> {
  await expect
    .poll(async () => (await getMatch(matchId))?.status, {
      message: `match ${matchId} → ${status}`,
    })
    .toBe(status);
}

export function playerById(players: Player[], id: UUID | null): Player {
  const player = players.find((p) => p.id === id);
  if (!player) throw new Error(`no session for player ${String(id)}`);
  return player;
}

/**
 * One match the way it happens at the club: both players check in at the
 * table («Я у стола»), the loser enters the score, the winner confirms it.
 *
 * The match is re-read first: the caller's snapshot may predate the table
 * call, and the modal hides the score form for a called match that hasn't
 * started.
 */
export async function playMatchViaUi(
  snapshot: Match,
  players: Player[],
  winnerId: UUID,
  loserScore = 0,
): Promise<void> {
  const match = await getMatch(snapshot.id);
  if (!match) throw new Error(`match ${snapshot.id} not found`);
  const tournament = await getTournament(match.tournamentId);
  if (!tournament) throw new Error('tournament not found');

  const p1 = playerById(players, match.player1Id);
  const p2 = playerById(players, match.player2Id);
  const winner = p1.id === winnerId ? p1 : p2;
  const loser = p1.id === winnerId ? p2 : p1;

  // Called to a table: check-in starts the match once both have confirmed.
  if (match.status === 'scheduled' && isCalled(match)) {
    for (const p of [p1, p2]) {
      const readyAt = p === p1 ? match.player1ReadyAt : match.player2ReadyAt;
      if (readyAt === null)
        await new PlayerMatchesPage(p.page).markReady(match.id);
    }
    await waitForMatchStatus(match.id, 'in_progress');
  }

  const winScore = winScoreForMatch(match, tournament);
  const loserView = new PlayerMatchesPage(loser.page);
  if (tournament.discipline.startsWith('snooker')) {
    // Frame by frame: the loser's frames first, so the match isn't decided
    // (and the form closed to new rows) before the last frame is in.
    const frame = (p1Won: boolean) =>
      p1Won ? { p1: 60, p2: 25 } : { p1: 25, p2: 60 };
    await loserView.reportFrames(match.id, [
      ...Array.from({ length: loserScore }, () => frame(loser === p1)),
      ...Array.from({ length: winScore }, () => frame(winner === p1)),
    ]);
  } else {
    await loserView.report(match.id, [
      { name: p1.name, score: p1 === winner ? winScore : loserScore },
      { name: p2.name, score: p2 === winner ? winScore : loserScore },
    ]);
  }
  await waitForMatchStatus(match.id, 'pending_confirmation');
  // Two-phase confirmation: the reporter can't confirm their own result.
  await expect(loserView.button('Подтвердить')).toHaveCount(0);

  await new PlayerMatchesPage(winner.page).confirm(match.id);
  await waitForMatchStatus(match.id, 'completed');
}

/**
 * Play every match through the UI until the tournament completes, the way a
 * club day runs: only matches called to a table are played, so each result
 * also exercises the table queue (a freed table calls the next pair in).
 * `pickWinner` decides each result so tests can assert the final standings.
 * Returns the matches in the order they were played.
 */
export async function playOutTournament(
  tournamentId: UUID,
  players: Player[],
  pickWinner: (match: Match) => UUID,
): Promise<Match[]> {
  const played: Match[] = [];
  for (let i = 0; i < 50; i++) {
    // Advancement, the next table call and completion all land a moment
    // after the confirm.
    let next: Match | undefined;
    let snapshot: Match[] = [];
    try {
      await expect
        .poll(async () => {
          if ((await getTournament(tournamentId))?.status === 'completed') {
            return 'completed';
          }
          snapshot = await getTournamentMatches(tournamentId);
          next = calledOpen(snapshot)[0];
          return next ? 'playable' : 'stuck';
        })
        .not.toBe('stuck');
    } catch {
      const state = snapshot.map(
        (m) =>
          `r${String(m.round)} ${String(m.bracketType)} ${m.status} ` +
          `${String(m.player1Id)} vs ${String(m.player2Id)} ` +
          `table=${String(m.tableId)} called=${String(m.calledAt)}`,
      );
      throw new Error(
        `tournament ${tournamentId} is stuck: not completed, no match called\n` +
          state.join('\n'),
      );
    }
    if (!next) return played;

    // Alternate 2:0 / 2:1 so both score shapes are exercised.
    await playMatchViaUi(next, players, pickWinner(next), played.length % 2);
    played.push(next);
  }
  throw new Error(`tournament ${tournamentId} did not finish in 50 matches`);
}

/** Lower player index wins — a deterministic "stronger player" for asserts. */
export function strongerPlayerWins(players: Player[]) {
  return (m: Match): UUID => {
    const i1 = players.findIndex((p) => p.id === m.player1Id);
    const i2 = players.findIndex((p) => p.id === m.player2Id);
    const winner = i1 < i2 ? m.player1Id : m.player2Id;
    if (!winner) throw new Error(`match ${m.id} has an empty slot`);
    return winner;
  };
}
