import type { UUID } from 'crypto';

// Pure group-standings + qualification logic for the groups_playoff format.
// NO database imports — this module operates on plain match/member lists so it is
// fully unit-testable. The DB-facing wrapper lives in groupPhaseService.ts.

export interface StandingMember {
  userId: UUID;
  /** Original tournament seed; used as the final, always-decisive tiebreak. */
  seed: number | null;
}

export interface StandingMatch {
  player1Id: UUID | null;
  player2Id: UUID | null;
  winnerId: UUID | null;
  player1Score: number | null;
  player2Score: number | null;
  status: string; // only 'completed' matches count toward standings
}

export interface PlayerStanding {
  userId: UUID;
  seed: number | null;
  played: number;
  wins: number;
  losses: number;
  framesWon: number;
  framesLost: number;
  frameDiff: number;
  /** 1-based final position within the group (always unique — seed breaks ties). */
  rank: number;
}

export interface GroupStanding {
  groupIndex: number;
  rows: PlayerStanding[]; // sorted best-first
}

/** Lower seed number is better; a missing seed sorts last. */
function seedRank(seed: number | null): number {
  return seed ?? Number.POSITIVE_INFINITY;
}

type Mutable = Omit<PlayerStanding, 'rank'>;

/**
 * Compute the ranked standing of a single group from its completed matches.
 *
 * Tiebreak order (each level only re-orders players still tied above it):
 *   1. match wins
 *   2. head-to-head wins among the currently-tied subset (computed as a per-player
 *      scalar over the subset, so it stays transitive; a cycle like A>B>C>A leaves
 *      everyone equal and falls through)
 *   3. frame difference (framesWon − framesLost)
 *   4. frames won
 *   5. best seed (decisive — guarantees a total order, never stalls)
 */
export function computeGroupStanding(
  groupIndex: number,
  members: StandingMember[],
  groupMatches: StandingMatch[],
): GroupStanding {
  const stats = new Map<UUID, Mutable>();
  for (const m of members) {
    stats.set(m.userId, {
      userId: m.userId,
      seed: m.seed,
      played: 0,
      wins: 0,
      losses: 0,
      framesWon: 0,
      framesLost: 0,
      frameDiff: 0,
    });
  }

  // All completed matches count. A match against a walkover (a missing slot) has
  // one null player — it still counts as a win for the real member who is present.
  const completed = groupMatches.filter((m) => m.status === 'completed');

  for (const m of completed) {
    const { player1Id, player2Id } = m;
    const p1 = player1Id != null ? stats.get(player1Id) : undefined;
    const p2 = player2Id != null ? stats.get(player2Id) : undefined;
    const s1 = m.player1Score ?? 0;
    const s2 = m.player2Score ?? 0;

    if (p1 && p2) {
      // Real vs real.
      p1.played += 1;
      p2.played += 1;
      p1.framesWon += s1;
      p1.framesLost += s2;
      p2.framesWon += s2;
      p2.framesLost += s1;
      if (m.winnerId === player1Id) {
        p1.wins += 1;
        p2.losses += 1;
      } else if (m.winnerId === player2Id) {
        p2.wins += 1;
        p1.losses += 1;
      }
    } else if (p1 && !p2) {
      // Real (player1) vs walkover.
      p1.played += 1;
      p1.framesWon += s1;
      p1.framesLost += s2;
      if (m.winnerId === player1Id) p1.wins += 1;
      else p1.losses += 1;
    } else if (p2 && !p1) {
      // Real (player2) vs walkover.
      p2.played += 1;
      p2.framesWon += s2;
      p2.framesLost += s1;
      if (m.winnerId === player2Id) p2.wins += 1;
      else p2.losses += 1;
    }
  }

  for (const s of stats.values()) {
    s.frameDiff = s.framesWon - s.framesLost;
  }

  // Head-to-head wins of `player` against the given tied subset (completed only).
  const h2hWins = (playerId: UUID, subset: Set<UUID>): number =>
    completed.filter((m) => {
      const { player1Id, player2Id } = m;
      if (player1Id == null || player2Id == null) return false;
      if (m.winnerId !== playerId) return false;
      return (
        (player1Id === playerId && subset.has(player2Id)) ||
        (player2Id === playerId && subset.has(player1Id))
      );
    }).length;

  const ordered = [...stats.values()];
  // 1. Primary sort by wins; partition into equal-wins tiers.
  ordered.sort((a, b) => b.wins - a.wins);

  const sorted: Mutable[] = [];
  let i = 0;
  while (i < ordered.length) {
    let j = i + 1;
    while (j < ordered.length && ordered[j]?.wins === ordered[i]?.wins) j++;
    const tier = ordered.slice(i, j);
    if (tier.length === 1) {
      sorted.push(...tier);
    } else {
      const tierIds = new Set(tier.map((t) => t.userId));
      const h2h = new Map<UUID, number>(
        tier.map((t) => [t.userId, h2hWins(t.userId, tierIds)]),
      );
      tier.sort((a, b) => {
        const ha = h2h.get(a.userId) ?? 0;
        const hb = h2h.get(b.userId) ?? 0;
        if (hb !== ha) return hb - ha;
        if (b.frameDiff !== a.frameDiff) return b.frameDiff - a.frameDiff;
        if (b.framesWon !== a.framesWon) return b.framesWon - a.framesWon;
        return seedRank(a.seed) - seedRank(b.seed);
      });
      sorted.push(...tier);
    }
    i = j;
  }

  return {
    groupIndex,
    rows: sorted.map((s, idx) => ({ ...s, rank: idx + 1 })),
  };
}

/**
 * The set of players who have mathematically **clinched** a top-`qualifiers` spot
 * in their group — guaranteed to qualify no matter how the remaining group matches
 * go. `totalMatches` is how many group matches each player plays in a full group
 * (participantsPerGroup − 1; walkover matches are already completed and counted in
 * `played`).
 *
 * Conservative (safe) by design: a player is marked only when, in their worst case
 * (they lose all remaining and every rival wins all remaining, ties breaking
 * against them), at most `qualifiers − 1` others can finish ahead. Once a group is
 * fully played this reduces to "rank ≤ qualifiers".
 */
export function clinchedUserIds(
  rows: PlayerStanding[],
  totalMatches: number,
  qualifiers: number,
): Set<UUID> {
  const result = new Set<UUID>();

  for (const x of rows) {
    const xFloor = x.wins; // worst case: x loses everything remaining
    const xRemaining = Math.max(0, totalMatches - x.played);

    let couldFinishAbove = 0;
    for (const y of rows) {
      if (y.userId === x.userId) continue;
      const yRemaining = Math.max(0, totalMatches - y.played);
      const yCeiling = y.wins + yRemaining; // best case: y wins everything

      if (yCeiling > xFloor) {
        couldFinishAbove += 1;
      } else if (yCeiling === xFloor) {
        // A win tie is possible. If both totals are already final the tiebreak is
        // decided (use rank); otherwise assume it could swing against x.
        if (yRemaining === 0 && xRemaining === 0) {
          if (y.rank < x.rank) couldFinishAbove += 1;
        } else {
          couldFinishAbove += 1;
        }
      }
    }

    if (couldFinishAbove < qualifiers) result.add(x.userId);
  }

  return result;
}

/**
 * Compute standings for every group.
 * `membersByGroup[g]` are the members of group g; `matchesByGroup[g]` its matches.
 */
export function computeAllStandings(
  membersByGroup: StandingMember[][],
  matchesByGroup: StandingMatch[][],
): GroupStanding[] {
  return membersByGroup.map((members, g) =>
    computeGroupStanding(g, members, matchesByGroup[g] ?? []),
  );
}

/**
 * Pick the top `qualifiersPerGroup` of each group and return them ORDERED for the
 * playoff bracket (feed straight into generatePlayoffFromQualifiers).
 *
 * Cross-seeding (best-effort): rank-1 finishers occupy the top seeds (so the two
 * strongest group winners land in opposite bracket halves), and each lower rank is
 * rotated by one group so a group's runner-up is kept away from its winner. Full
 * separation is impossible once qualifiersPerGroup is large, by design.
 */
export function selectQualifiers(
  standings: GroupStanding[],
  qualifiersPerGroup: number,
): UUID[] {
  const groupsCount = standings.length;
  const ordered: UUID[] = [];

  for (let rank = 0; rank < qualifiersPerGroup; rank++) {
    for (let g = 0; g < groupsCount; g++) {
      const group = standings[(g + rank) % groupsCount];
      const row = group?.rows[rank];
      if (row) ordered.push(row.userId);
    }
  }

  return ordered;
}
