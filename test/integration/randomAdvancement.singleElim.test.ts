import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTournamentMatches } from '@/services/matchService.js';
import { getTournament } from '@/services/tournamentService.js';
import { bot } from '@/bot/instance.js';

import {
  completeMatch,
  createMatchesForTournament,
  createTournamentWithParticipants,
  playAllReady,
} from '../helpers/factories.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

describe('single elimination with randomAdvancement', () => {
  beforeAll(() => {
    vi.spyOn(bot.api, 'sendMessage').mockResolvedValue(
      {} as Awaited<ReturnType<typeof bot.api.sendMessage>>,
    );
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('generates an unrouted winners-only bracket (no nextMatchId)', async () => {
    const { tournament } = await createTournamentWithParticipants(
      8,
      'single_elimination',
      { randomAdvancement: true },
    );
    await createMatchesForTournament(tournament.id, 'single_elimination');

    const all = await getTournamentMatches(tournament.id);
    expect(all).toHaveLength(7);
    expect(all.every((m) => m.bracketType === 'winners')).toBe(true);
    expect(all.every((m) => m.nextMatchId === null)).toBe(true);

    // Round 1 is fully seeded; later rounds start empty (filled at runtime).
    const round1 = all.filter((m) => m.round === 1);
    expect(round1).toHaveLength(4);
    expect(
      round1.every((m) => m.player1Id !== null && m.player2Id !== null),
    ).toBe(true);
    expect(
      all
        .filter((m) => m.round > 1)
        .every((m) => m.player1Id === null && m.player2Id === null),
    ).toBe(true);
  });

  it('places round-1 winners into random free slots of round 2', async () => {
    const { tournament } = await createTournamentWithParticipants(
      8,
      'single_elimination',
      { randomAdvancement: true },
    );
    await createMatchesForTournament(tournament.id, 'single_elimination');

    let all = await getTournamentMatches(tournament.id);
    const round1 = all.filter((m) => m.round === 1);
    const winners: string[] = [];
    for (const m of round1) {
      const winner = must(m.player1Id);
      winners.push(winner);
      await completeMatch(m.id, winner);
    }

    all = await getTournamentMatches(tournament.id);
    const round2 = all.filter((m) => m.round === 2);
    expect(round2).toHaveLength(2);
    // All four winners are now distributed across round 2's four slots.
    const placed = round2.flatMap((m) =>
      [m.player1Id, m.player2Id].filter((id): id is string => id !== null),
    );
    expect(placed.sort()).toEqual([...winners].sort());
  });

  it('runs to completion and crowns a single champion', async () => {
    const { tournament } = await createTournamentWithParticipants(
      8,
      'single_elimination',
      { randomAdvancement: true },
    );
    await createMatchesForTournament(tournament.id, 'single_elimination');

    await playAllReady(tournament.id, 'single_elimination');

    expect((await getTournament(tournament.id))?.status).toBe('completed');

    const all = await getTournamentMatches(tournament.id);
    const maxRound = all.reduce((max, m) => Math.max(max, m.round), 0);
    const final = must(all.find((m) => m.round === maxRound));
    expect(final.status).toBe('completed');
    expect(final.winnerId).not.toBeNull();
  });
});
