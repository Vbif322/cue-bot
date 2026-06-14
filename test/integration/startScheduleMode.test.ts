import type { Api } from 'grammy';
import { eq } from 'drizzle-orm';
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
