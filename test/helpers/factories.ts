import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import {
  loginTokens,
  tournamentParticipants,
  tournaments,
  users,
  venues,
} from '@/db/schema.js';
import type { ITournamentFormat } from '@/db/schema/tournaments.js';
import type { Match } from '@/bot/@types/match.js';
import { generateBracket } from '@/services/bracketGenerator.js';
import {
  createMatches,
  getMatch,
  getTournamentMatches,
  reportResult,
  confirmResult,
} from '@/services/matchService.js';
import {
  getConfirmedParticipantsBySeed,
  getTournament,
  startTournament,
} from '@/services/tournamentService.js';

import { must } from './must.js';

/**
 * Test-data factories. Phase 0b ships the two leaf entities needed to validate
 * the harness; tournament/match/participant factories are added in Phase 2.
 */
let seq = 0;
const uniq = (): string => `${Date.now().toString(36)}_${String(seq++)}`;

export async function createUser(
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const [row] = await db
    .insert(users)
    .values({ username: `user_${uniq()}`, ...overrides })
    .returning();
  if (!row) throw new Error('insert returned no rows');
  return row;
}

/** A user with `role: 'admin'` — convenience wrapper used by admin-API tests. */
export async function createAdminUser(
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  return createUser({ role: 'admin', ...overrides });
}

/**
 * Insert a one-click login token (`loginTokens` table). Defaults to a token
 * that expires one hour from now; pass `expiresAt` in the past to test expiry.
 */
export async function createLoginToken(
  userId: UUID,
  overrides: Partial<typeof loginTokens.$inferInsert> = {},
) {
  const [row] = await db
    .insert(loginTokens)
    .values({
      token: `tok_${uniq()}`.slice(0, 32),
      userId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no rows');
  return row;
}

/**
 * Create a tournament and `count` confirmed participants seeded 1..count, so
 * bracket generation gets a deterministic seed order (no random `fillMissingSeeds`).
 * `participantIds[i]` holds seed `i + 1`. Stays in `registration_open` until a
 * caller starts it (e.g. via `createMatchesForTournament`).
 */
export async function createTournamentWithParticipants(
  count: number,
  format: ITournamentFormat,
  opts: Partial<typeof tournaments.$inferInsert> = {},
): Promise<{
  tournament: Awaited<ReturnType<typeof createTournament>>;
  participantIds: UUID[];
}> {
  const tournament = await createTournament({
    format,
    status: 'registration_open',
    ...opts,
  });

  const participantIds: UUID[] = [];
  for (let seed = 1; seed <= count; seed++) {
    const { userId } = await createConfirmedParticipant(tournament.id, { seed });
    participantIds.push(userId);
  }

  return { tournament, participantIds };
}

/**
 * Build real match rows for a started tournament without going through
 * `startTournamentFull` (no tables, no bot): generate the bracket from the
 * confirmed participants, persist it, and flip the tournament to `in_progress`.
 * Returns all created matches (with joined player info), ordered by round/position.
 */
export async function createMatchesForTournament(
  tournamentId: UUID,
  format: ITournamentFormat,
) {
  const tournament = await getTournament(tournamentId);
  const participants = await getConfirmedParticipantsBySeed(tournamentId);
  const bracket = generateBracket(
    format,
    participants,
    tournament?.randomAdvancement ?? false,
  );
  await createMatches(tournamentId, bracket);
  await startTournament(tournamentId);
  return getTournamentMatches(tournamentId);
}

/**
 * Report + confirm a match so `winnerId` wins `winScore`-0. Reported by the
 * loser and confirmed by the winner (any two distinct participants work). Throws
 * with the service error string if either step fails, so tests fail loudly.
 */
export async function completeMatch(
  matchId: UUID,
  winnerId: UUID,
): Promise<void> {
  const match = await getMatch(matchId);
  if (!match) throw new Error(`completeMatch: match ${matchId} not found`);
  if (!match.player1Id || !match.player2Id) {
    throw new Error(`completeMatch: match ${matchId} missing a player`);
  }

  const tournament = await getTournament(match.tournamentId);
  if (!tournament) throw new Error('completeMatch: tournament not found');
  const winScore = tournament.winScore;

  const loserId =
    match.player1Id === winnerId ? match.player2Id : match.player1Id;
  const player1Score = match.player1Id === winnerId ? winScore : 0;
  const player2Score = match.player2Id === winnerId ? winScore : 0;

  const reported = await reportResult(
    matchId,
    loserId,
    player1Score,
    player2Score,
  );
  if (!reported.success) {
    throw new Error(`completeMatch report failed: ${reported.error ?? ''}`);
  }
  const confirmed = await confirmResult(matchId, winnerId);
  if (!confirmed.success) {
    throw new Error(`completeMatch confirm failed: ${confirmed.error ?? ''}`);
  }
}

/**
 * Generic bracket driver: repeatedly complete any match that has both players
 * and is still open, until the tournament completes. `pickWinner` chooses the
 * winner of a match (defaults to player1). Capped to avoid an infinite loop on
 * a logic bug.
 */
export async function playAllReady(
  tournamentId: UUID,
  format: ITournamentFormat,
  pickWinner: (match: Match) => UUID = (m) => must(m.player1Id, 'player1Id'),
): Promise<void> {
  for (let iteration = 0; iteration < 200; iteration++) {
    const tournament = await getTournament(tournamentId);
    if (tournament?.status === 'completed') return;

    const all = await getTournamentMatches(tournamentId);
    const ready = all.find(
      (m) =>
        m.player1Id !== null &&
        m.player2Id !== null &&
        (m.status === 'scheduled' || m.status === 'in_progress'),
    );
    if (!ready) break;

    await completeMatch(ready.id, pickWinner(ready));
  }

  const tournament = await getTournament(tournamentId);
  if (tournament?.status !== 'completed') {
    throw new Error(
      `playAllReady(${format}): tournament ${tournamentId} did not complete`,
    );
  }
}

export async function createVenue(
  overrides: Partial<typeof venues.$inferInsert> = {},
) {
  const [row] = await db
    .insert(venues)
    .values({ name: `Venue ${uniq()}`, address: 'Test address', ...overrides })
    .returning();
  if (!row) throw new Error('insert returned no rows');
  return row;
}

/**
 * Insert a confirmed participant. Creates a fresh user unless `userId` is given.
 * Returns the participant's `userId` (the bracket layer only needs that).
 */
export async function createConfirmedParticipant(
  tournamentId: UUID,
  opts: { seed?: number; userId?: UUID } = {},
): Promise<{ userId: UUID }> {
  const userId = opts.userId ?? (await createUser()).id;
  await db.insert(tournamentParticipants).values({
    tournamentId,
    userId,
    status: 'confirmed',
    seed: opts.seed ?? null,
  });
  return { userId };
}

/**
 * Insert a tournament. A venue and creator are auto-created when not supplied
 * (both are NOT NULL foreign keys). Defaults to a public single-elimination
 * snooker draft; override `visibility`/`status`/etc. as needed.
 */
export async function createTournament(
  overrides: Partial<typeof tournaments.$inferInsert> = {},
) {
  const venueId = overrides.venueId ?? (await createVenue()).id;
  const createdBy = overrides.createdBy ?? (await createUser()).id;

  const [row] = await db
    .insert(tournaments)
    .values({
      name: `Tournament ${uniq()}`,
      discipline: 'snooker',
      format: 'single_elimination',
      ...overrides,
      venueId,
      createdBy,
    })
    .returning();
  if (!row) throw new Error('insert returned no rows');
  return row;
}
