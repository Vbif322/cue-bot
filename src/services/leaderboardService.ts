import { and, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { matchFrames, matches, tournaments, users } from '@/db/schema.js';
import type { ITournamentVisibility } from '@/db/schema/tournaments.js';
import type { ApiMaxBreakLeaderboardEntry } from '@/bot/@types/user.js';

/** Breaks below this are not leaderboard-worthy. */
export const MIN_LEADERBOARD_BREAK = 20;

export interface MaxBreakLeaderboardEntry {
  /** Competition rank: equal breaks share a place (1, 1, 3). */
  rank: number;
  userId: UUID;
  name: string | null;
  surname: string | null;
  username: string;
  maxBreak: number;
  /** When the match with the break was completed. */
  achievedAt: Date | null;
  tournament: { id: UUID; name: string; visibility: ITournamentVisibility };
}

interface BestBreak {
  value: number;
  achievedAt: Date | null;
  tournament: MaxBreakLeaderboardEntry['tournament'];
}

// A missing date sorts last (MAX_SAFE_INTEGER, not Infinity: Infinity - Infinity is NaN).
const time = (d: Date | null): number =>
  d?.getTime() ?? Number.MAX_SAFE_INTEGER;

/**
 * Each player's highest break (snooker) of at least `minBreak`, best first; on equal
 * breaks whoever made it earlier ranks higher. Break values are per-slot:
 * `player1Break` belongs to the match's `player1Id`, `player2Break` to its `player2Id`.
 * Soft-deleted users are left out.
 */
export async function getMaxBreakLeaderboard(
  minBreak = MIN_LEADERBOARD_BREAK,
): Promise<MaxBreakLeaderboardEntry[]> {
  const rows = await db
    .select({
      player1Id: matches.player1Id,
      player2Id: matches.player2Id,
      player1Break: matchFrames.player1Break,
      player2Break: matchFrames.player2Break,
      completedAt: matches.completedAt,
      tournamentId: tournaments.id,
      tournamentName: tournaments.name,
      visibility: tournaments.visibility,
    })
    .from(matchFrames)
    .innerJoin(matches, eq(matchFrames.matchId, matches.id))
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .where(
      and(
        // Frames of a scheduled/in_progress match are a draft; technical results
        // drop their frames, but guard anyway.
        eq(matches.status, 'completed'),
        eq(matches.isTechnicalResult, false),
        or(
          gte(matchFrames.player1Break, minBreak),
          gte(matchFrames.player2Break, minBreak),
        ),
      ),
    );

  const best = new Map<UUID, BestBreak>();
  const record = (
    userId: UUID | null,
    value: number | null,
    r: (typeof rows)[number],
  ): void => {
    if (userId == null || value == null || value < minBreak) return;
    const prev = best.get(userId);
    if (
      prev != null &&
      (value < prev.value ||
        (value === prev.value && time(r.completedAt) >= time(prev.achievedAt)))
    ) {
      return;
    }
    best.set(userId, {
      value,
      achievedAt: r.completedAt,
      tournament: {
        id: r.tournamentId,
        name: r.tournamentName,
        visibility: r.visibility,
      },
    });
  };
  for (const r of rows) {
    record(r.player1Id, r.player1Break, r);
    record(r.player2Id, r.player2Break, r);
  }
  if (best.size === 0) return [];

  const players = await db
    .select({
      id: users.id,
      name: users.name,
      surname: users.surname,
      username: users.username,
    })
    .from(users)
    .where(and(inArray(users.id, [...best.keys()]), isNull(users.deletedAt)));

  const sorted = players
    .map((u) => ({ user: u, best: best.get(u.id) }))
    .filter(
      (p): p is { user: typeof p.user; best: BestBreak } => p.best != null,
    )
    .sort(
      (a, b) =>
        b.best.value - a.best.value ||
        time(a.best.achievedAt) - time(b.best.achievedAt),
    );

  const entries: MaxBreakLeaderboardEntry[] = [];
  for (const [i, { user, best: b }] of sorted.entries()) {
    const prev = entries[i - 1];
    entries.push({
      rank: prev?.maxBreak === b.value ? prev.rank : i + 1,
      userId: user.id,
      name: user.name,
      surname: user.surname,
      username: user.username,
      maxBreak: b.value,
      achievedAt: b.achievedAt,
      tournament: b.tournament,
    });
  }
  return entries;
}

/**
 * API shape of a leaderboard row. With `hidePrivateTournaments` (the public player
 * API) a private tournament is reported as `null` so its name doesn't leak to
 * guests; the player and the break are still shown.
 */
export function toApiMaxBreakEntry(
  entry: MaxBreakLeaderboardEntry,
  { hidePrivateTournaments }: { hidePrivateTournaments: boolean },
): ApiMaxBreakLeaderboardEntry {
  const { tournament, achievedAt, ...rest } = entry;
  return {
    ...rest,
    achievedAt: achievedAt?.toISOString() ?? null,
    tournament:
      hidePrivateTournaments && tournament.visibility !== 'public'
        ? null
        : { id: tournament.id, name: tournament.name },
  };
}
