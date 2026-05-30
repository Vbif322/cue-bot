/**
 * Seed a ready-to-correct tournament for the result-correction smoke test.
 *
 * Builds an 8-player single-elimination bracket and plays it to completion, so
 * the bracket has `completed` matches you can correct from the admin UI. Prints
 * the URLs and the exact match to flip plus the expected outcome.
 *
 * Run:  npx tsx --env-file=.env scripts/seed-correction-smoke.ts
 * Re-running first wipes the previous smoke data, so it is safe to repeat.
 * Cleanup: see the printed DELETE at the end (or just re-run / drop the tournament).
 */
import { eq, like } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '../src/db/db.js';
import { matches, tournaments, users, venues } from '../src/db/schema.js';
import { advanceWinner } from '../src/services/matchService.js';

const T_NAME = 'SMOKE Correction Test';
const V_NAME = 'SMOKE Venue';
const WEB = 'http://localhost:5173';

async function wipePrevious() {
  const old = await db.query.tournaments.findMany({
    where: eq(tournaments.name, T_NAME),
  });
  for (const t of old) {
    await db.delete(tournaments).where(eq(tournaments.id, t.id)); // cascades matches + corrections
  }
  await db.delete(users).where(like(users.username, 'smoke_%'));
  await db.delete(venues).where(eq(venues.name, V_NAME));
}

async function main() {
  await wipePrevious();

  const [venue] = await db
    .insert(venues)
    .values({ name: V_NAME, address: 'Smoke st. 1' })
    .returning({ id: venues.id });

  const playerRows = await db
    .insert(users)
    .values([
      { username: 'smoke_admin', role: 'admin' as const },
      ...Array.from({ length: 8 }, (_, i) => ({
        username: `smoke_player_${i + 1}`,
        name: `Игрок ${i + 1}`,
      })),
    ])
    .returning({ id: users.id, username: users.username });
  const pid = (u: string) =>
    playerRows.find((r) => r.username === u)!.id as UUID;
  const admin = pid('smoke_admin');
  const P = (n: number) => pid(`smoke_player_${n}`);

  const [t] = await db
    .insert(tournaments)
    .values({
      venueId: venue!.id,
      name: T_NAME,
      discipline: 'snooker',
      format: 'single_elimination',
      status: 'in_progress',
      maxParticipants: 8,
      winScore: 3,
      createdBy: admin,
    })
    .returning({ id: tournaments.id });
  const tid = t!.id as UUID;

  const mk = async (
    round: number,
    position: number,
    extra: Record<string, unknown> = {},
  ) => {
    const [m] = await db
      .insert(matches)
      .values({
        tournamentId: tid,
        round,
        position,
        bracketType: 'winners',
        status: 'scheduled',
        ...extra,
      })
      .returning({ id: matches.id });
    return m!.id as UUID;
  };

  // Bracket: R1 (pos1-4) → semis (pos5-6) → final (pos7).
  const M7 = await mk(3, 7);
  const M5 = await mk(2, 5, { nextMatchId: M7, nextMatchPosition: 'player1' });
  const M6 = await mk(2, 6, { nextMatchId: M7, nextMatchPosition: 'player2' });
  const M1 = await mk(1, 1, { player1Id: P(1), player2Id: P(2), nextMatchId: M5, nextMatchPosition: 'player1' });
  const M2 = await mk(1, 2, { player1Id: P(3), player2Id: P(4), nextMatchId: M5, nextMatchPosition: 'player2' });
  const M3 = await mk(1, 3, { player1Id: P(5), player2Id: P(6), nextMatchId: M6, nextMatchPosition: 'player1' });
  const M4 = await mk(1, 4, { player1Id: P(7), player2Id: P(8), nextMatchId: M6, nextMatchPosition: 'player2' });

  const play = async (id: UUID, p1: number, p2: number, winnerId: UUID) => {
    await db
      .update(matches)
      .set({ player1Score: p1, player2Score: p2, winnerId, status: 'completed', completedAt: new Date() })
      .where(eq(matches.id, id));
    await advanceWinner(id);
  };

  // Play it out: lower seed always wins → champion = Игрок 1.
  await play(M1, 3, 0, P(1)); // Игрок 1 beats Игрок 2
  await play(M2, 3, 0, P(3));
  await play(M3, 3, 0, P(5));
  await play(M4, 3, 0, P(7));
  await play(M5, 3, 1, P(1)); // semi: Игрок 1 beats Игрок 3
  await play(M6, 3, 1, P(5)); // semi: Игрок 5 beats Игрок 7
  await play(M7, 3, 2, P(1)); // final: Игрок 1 champion

  console.log(`
=== SMOKE fixture ready ===

Tournament:  ${WEB}/tournaments/${tid}
Champion:    Игрок 1   (tournament status = completed)

WINNER-FLIP target — R1 #1 "Игрок 1 : Игрок 2" (completed 3:0):
  ${WEB}/matches/${M1}
  → correct to 0:3 (Игрок 2 wins). Expect: 2 matches reset (semi #5 + final #7),
    tournament re-opens to in_progress, Игрок 2 advances into semi #5.

SCORE-ONLY target — R1 #2 "Игрок 3 : Игрок 4" (completed 3:0):
  ${WEB}/matches/${M2}
  → correct to 3:1 (Игрок 3 still wins). Expect: 0 matches reset, badge appears.

Match ids:  M1=${M1}  M2=${M2}  semi5=${M5}  final7=${M7}

Verify in DB (psql):
  docker exec drizzle-postgres psql -U vbif -d cue_bot -c "SELECT round, position, status, player1_score, player2_score, is_corrected FROM prod.matches WHERE tournament_id='${tid}' ORDER BY round, position;"
  docker exec drizzle-postgres psql -U vbif -d cue_bot -c "SELECT reason, previous_winner_id, new_winner_id, affected_match_ids FROM prod.match_corrections WHERE tournament_id='${tid}';"

Cleanup when done:
  docker exec drizzle-postgres psql -U vbif -d cue_bot -c "DELETE FROM prod.tournaments WHERE id='${tid}';"
  (then delete smoke_% users / SMOKE venue, or just re-run this script)
`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
