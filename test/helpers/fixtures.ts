import type { UUID } from 'crypto';

import type { TournamentParticipant } from '@/bot/@types/tournament.js';

/**
 * Build a TournamentParticipant. Bracket generation only reads `userId`, so the
 * id doubles as a readable label (cast to UUID — the value is opaque here).
 */
export function makeParticipant(
  id: string,
  seed: number | null = null,
): TournamentParticipant {
  return { userId: id as UUID, username: id, name: id, seed };
}

/** `n` participants labelled p1..pN, each seeded 1..N in order. */
export function makeParticipants(n: number): TournamentParticipant[] {
  return Array.from({ length: n }, (_, i) =>
    makeParticipant(`p${String(i + 1)}`, i + 1),
  );
}
