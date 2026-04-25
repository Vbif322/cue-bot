import { and, eq, isNull } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { matches } from '@/db/schema.js';

export type Pool = { bracketType: 'winners' | 'losers'; round: number };

/**
 * Maps a (bracketType, round, role) of a finished DE match to the pool of
 * matches the player should be placed into. Returns null when there is no
 * advancement (eliminated, or champion).
 *
 * Single source of truth for double_elimination_random transitions.
 */
export function getRandomTargetPool(
  match: { bracketType: string | null; round: number },
  isWinner: boolean,
): Pool | null {
  const bt = match.bracketType;
  const r = match.round;

  if (bt === 'winners') {
    if (isWinner) {
      if (r >= 1 && r <= 4) return { bracketType: 'winners', round: r + 1 };
      return null; // R5 winner = champion
    }
    if (r === 1) return { bracketType: 'losers', round: 1 };
    if (r === 2) return { bracketType: 'losers', round: 2 };
    return null; // R3+ winners loser is eliminated
  }

  if (bt === 'losers') {
    if (!isWinner) return null;
    if (r === 1) return { bracketType: 'losers', round: 2 };
    if (r === 2) return { bracketType: 'winners', round: 3 }; // merge
    return null;
  }

  return null;
}

/**
 * Atomically place a player into a random free slot of the target pool.
 * Uses conditional UPDATE with retry to avoid races between concurrent
 * advancements (no transactions / row locks needed).
 */
export async function placeIntoRandomFreeSlot(
  tournamentId: UUID,
  pool: Pool,
  playerId: UUID,
): Promise<{ matchId: UUID; slot: 'player1' | 'player2' }> {
  const MAX_ATTEMPTS = 20;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidates = await db.query.matches.findMany({
      where: and(
        eq(matches.tournamentId, tournamentId),
        eq(matches.bracketType, pool.bracketType),
        eq(matches.round, pool.round),
      ),
    });

    const slots: Array<{ matchId: UUID; slot: 'player1' | 'player2' }> = [];
    for (const m of candidates) {
      if (m.player1Id === null && !m.player1IsWalkover) {
        slots.push({ matchId: m.id, slot: 'player1' });
      }
      if (m.player2Id === null && !m.player2IsWalkover) {
        slots.push({ matchId: m.id, slot: 'player2' });
      }
    }

    if (slots.length === 0) {
      throw new Error(
        `No free slot in pool ${pool.bracketType}/${pool.round} for tournament ${tournamentId}`,
      );
    }

    const pick = slots[Math.floor(Math.random() * slots.length)]!;
    const slotCol =
      pick.slot === 'player1' ? matches.player1Id : matches.player2Id;
    const slotKey = pick.slot === 'player1' ? 'player1Id' : 'player2Id';

    const updated = await db
      .update(matches)
      .set({ [slotKey]: playerId, updatedAt: new Date() })
      .where(and(eq(matches.id, pick.matchId), isNull(slotCol)))
      .returning({ id: matches.id });

    if (updated.length === 1) return pick;
    // slot was taken between snapshot and update — retry with fresh snapshot
  }

  throw new Error(
    `Failed to place player into random slot after ${MAX_ATTEMPTS} attempts (pool ${pool.bracketType}/${pool.round}, tournament ${tournamentId})`,
  );
}
