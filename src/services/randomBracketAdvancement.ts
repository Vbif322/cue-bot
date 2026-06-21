import { and, eq, isNull } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { matches } from '@/db/schema.js';

export interface Pool { bracketType: 'winners' | 'losers'; round: number }

/**
 * Maps a (bracketType, round, role) of a finished DE match to the pool of
 * matches the player should be placed into. Returns null when there is no
 * advancement (eliminated, or champion). Parameterized by `mergeRound` (M) and
 * `bracketSize` (N=2^k) so it works for any bracket size and merge round.
 *
 * Winners side has rounds 1..k+1 (upper 1..M, merge playoff M+1..k+1). Losers
 * bracket has rounds 1..2(M-1): odd = minor (play-down), even = major (absorbs
 * an upper drop). At M=2,k=4 this reduces to the historical fixed layout.
 *
 * Single source of truth for double-elimination random-advancement transitions.
 */
export function getRandomTargetPool(
  match: { bracketType: string | null; round: number },
  isWinner: boolean,
  mergeRound: number,
  bracketSize: number,
): Pool | null {
  const bt = match.bracketType;
  const r = match.round;
  const k = Math.log2(bracketSize);
  const m = Math.max(2, Math.min(mergeRound, k));

  if (bt === 'winners') {
    if (isWinner) {
      if (r < k + 1) return { bracketType: 'winners', round: r + 1 };
      return null; // terminal winners round = champion
    }
    // Only upper rounds 1..M drop a loser into the losers bracket.
    if (r === 1) return { bracketType: 'losers', round: 1 };
    if (r >= 2 && r <= m) return { bracketType: 'losers', round: 2 * (r - 1) };
    return null; // merge / upper round > M loser is eliminated
  }

  if (bt === 'losers') {
    if (!isWinner) return null;
    const lastLb = 2 * (m - 1);
    if (r < lastLb) return { bracketType: 'losers', round: r + 1 };
    if (r === lastLb) return { bracketType: 'winners', round: m + 1 }; // merge
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

    const slots: { matchId: UUID; slot: 'player1' | 'player2' }[] = [];
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
        `No free slot in pool ${pool.bracketType}/${String(pool.round)} for tournament ${tournamentId}`,
      );
    }

    const pick = slots[Math.floor(Math.random() * slots.length)];
    if (!pick) throw new Error('Unreachable: slots is non-empty after length check');
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
    `Failed to place player into random slot after ${String(MAX_ATTEMPTS)} attempts (pool ${pool.bracketType}/${String(pool.round)}, tournament ${tournamentId})`,
  );
}
