// Single source of truth for the discrete tournament option values.
// Imported by the Drizzle schema (server) and the React SPA (via @server alias).
// Keep this file dependency-free so it stays safe to bundle into the client.

export const maxParticipants = [8, 16, 32, 64, 128] as const;

export type ITournamentMaxParticipants = (typeof maxParticipants)[number];

export const winScores = [2, 3, 4, 5] as const;

export type ITournamentWinScore = (typeof winScores)[number];

// Double elimination "merge round": after which upper-bracket round the losers
// bracket merges back into a single-elimination playoff. 2 = standard/default,
// up to k = log2(bracketSize) (= full double elimination). Max k is 7 (128).
export const mergeRounds = [2, 3, 4, 5, 6, 7] as const;

export type ITournamentMergeRound = (typeof mergeRounds)[number];

/**
 * Valid merge rounds for a given participant cap: 2..k where k = log2 of the
 * nearest power of two >= maxParticipants. Dependency-free (safe for the SPA).
 */
export function validMergeRoundsForSize(maxParticipants: number): number[] {
  let size = 1;
  while (size < maxParticipants) size *= 2;
  const k = Math.max(2, Math.round(Math.log2(size)));
  const out: number[] = [];
  for (let m = 2; m <= k; m++) out.push(m);
  return out;
}
