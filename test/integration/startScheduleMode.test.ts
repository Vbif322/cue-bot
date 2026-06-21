import type { Api } from 'grammy';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import {
  matches,
  tables,
  tournamentParticipants,
  tournamentTables,
} from '@/db/schema.js';
import { startTournamentFull } from '@/services/tournamentStartService.js';
import type { ITournamentScheduleMode } from '@/db/schema.js';

import { createTournament, createUser, createVenue } from '../helpers/factories.js';
import { createMockBotApi } from '../helpers/mockBotApi.js';
import { truncateAll } from '../helpers/truncate.js';

/** Build a startable 2-player tournament with one linked table. */
async function setupTournament(scheduleMode: ITournamentScheduleMode) {
  const venue = await createVenue();
  const tournament = await createTournament({
    venueId: venue.id,
    status: 'registration_closed',
    format: 'single_elimination',
    scheduleMode,
  });

  const [table] = await db
    .insert(tables)
    .values({ name: 'Стол 1', venueId: venue.id })
    .returning();
  if (!table) throw new Error('insert returned no rows');
  await db
    .insert(tournamentTables)
    .values({ tournamentId: tournament.id, tableId: table.id, position: 0 });

  for (let i = 0; i < 2; i++) {
    const user = await createUser();
    await db.insert(tournamentParticipants).values({
      tournamentId: tournament.id,
      userId: user.id,
      status: 'confirmed',
      seed: i + 1,
    });
  }

  return tournament;
}

describe('startTournamentFull table auto-assignment by schedule mode', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('per_match: does NOT auto-assign a table or auto-start matches', async () => {
    const tournament = await setupTournament('per_match');
    const api = createMockBotApi() as unknown as Api;

    await startTournamentFull(tournament.id, api);

    const rows = await db.query.matches.findMany({
      where: eq(matches.tournamentId, tournament.id),
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((m) => m.tableId === null)).toBe(true);
    expect(rows.every((m) => m.status !== 'in_progress')).toBe(true);
  });

  it('single_day: auto-assigns the table and starts the first match', async () => {
    const tournament = await setupTournament('single_day');
    const api = createMockBotApi() as unknown as Api;

    await startTournamentFull(tournament.id, api);

    const rows = await db.query.matches.findMany({
      where: eq(matches.tournamentId, tournament.id),
    });
    expect(rows.some((m) => m.tableId !== null && m.status === 'in_progress')).toBe(
      true,
    );
  });
});

describe('startTournamentFull atomicity + idempotency (S4-6)', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('successful start: matches created, status in_progress, seeds set', async () => {
    const tournament = await setupTournament('per_match');
    const api = createMockBotApi() as unknown as Api;

    // Clear one seed so the in-transaction fillMissingSeeds path actually runs
    // and the "every seed set" assertion below is meaningful.
    await db
      .update(tournamentParticipants)
      .set({ seed: null })
      .where(
        and(
          eq(tournamentParticipants.tournamentId, tournament.id),
          eq(tournamentParticipants.seed, 1),
        ),
      );

    const result = await startTournamentFull(tournament.id, api);

    const rows = await db.query.matches.findMany({
      where: eq(matches.tournamentId, tournament.id),
    });
    expect(rows.length).toBe(result.matchesCreated);
    expect(rows.length).toBeGreaterThan(0);

    const updated = await db.query.tournaments.findFirst({
      where: (t, { eq: eqf }) => eqf(t.id, tournament.id),
    });
    expect(updated?.status).toBe('in_progress');

    const participants = await db.query.tournamentParticipants.findMany({
      where: eq(tournamentParticipants.tournamentId, tournament.id),
    });
    expect(participants.length).toBe(result.participantsCount);
    expect(participants.every((p) => p.seed != null)).toBe(true);
  });

  it('concurrent starts: exactly one wins, no duplicate matches', async () => {
    const tournament = await setupTournament('per_match');
    const api = createMockBotApi() as unknown as Api;

    const outcomes = await Promise.allSettled([
      startTournamentFull(tournament.id, api),
      startTournamentFull(tournament.id, api),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0]?.reason).toMatchObject({
      message: 'Турнир уже запущен',
    });

    const winner = fulfilled[0]?.value;
    const rows = await db.query.matches.findMany({
      where: eq(matches.tournamentId, tournament.id),
    });
    expect(rows.length).toBe(winner?.matchesCreated);
  });

  it('re-run after a successful start is rejected and leaves state unchanged', async () => {
    const tournament = await setupTournament('per_match');
    const api = createMockBotApi() as unknown as Api;

    await startTournamentFull(tournament.id, api);
    const before = await db.query.matches.findMany({
      where: eq(matches.tournamentId, tournament.id),
    });

    await expect(startTournamentFull(tournament.id, api)).rejects.toThrow(
      'Турнир уже запущен',
    );

    const after = await db.query.matches.findMany({
      where: eq(matches.tournamentId, tournament.id),
    });
    expect(after.length).toBe(before.length);
  });
});
