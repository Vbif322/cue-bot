// Single source of truth for the discrete tournament option values.
// Shared layer: imported by the Drizzle schema and services directly, and by the
// React SPA via the `@server/apiTypes` re-export. Keep this file dependency-free
// so it stays safe to bundle into the client.

export const maxParticipants = [8, 16, 32, 64, 128] as const;

export type ITournamentMaxParticipants = (typeof maxParticipants)[number];

export const winScores = [2, 3, 4, 5] as const;

export type ITournamentWinScore = (typeof winScores)[number];

// Group + playoff draw mode: how participants are assigned to groups.
export const groupDraws = ['snake', 'random'] as const;

export type IGroupDraw = (typeof groupDraws)[number];

// Discrete option sets offered by the creation UIs for the groups_playoff format.
export const groupsCountOptions = [2, 3, 4, 6, 8] as const;
export const participantsPerGroupOptions = [3, 4, 5, 6] as const;

/** Valid qualifier counts for a group size: 1..(size-1), capped at 4 for the UI. */
export function qualifiersOptionsForGroupSize(
  participantsPerGroup: number,
): number[] {
  const max = Math.min(participantsPerGroup - 1, 4);
  const out: number[] = [];
  for (let q = 1; q <= max; q++) out.push(q);
  return out;
}

export interface GroupConfig {
  groupsCount: number;
  participantsPerGroup: number;
  qualifiersPerGroup: number;
}

/**
 * Validate a groups_playoff configuration. Returns an error string (Russian) or
 * null if valid. Dependency-free so it is shared by the bot wizard, the admin
 * zod schema, and the tournament service. Total participants for the format is
 * always groupsCount × participantsPerGroup (groups must be full).
 */
export function validateGroupConfig(cfg: GroupConfig): string | null {
  const { groupsCount, participantsPerGroup, qualifiersPerGroup } = cfg;

  if (!Number.isInteger(groupsCount) || groupsCount < 2) {
    return 'Минимум 2 группы';
  }
  if (!Number.isInteger(participantsPerGroup) || participantsPerGroup < 2) {
    return 'Минимум 2 участника в группе';
  }
  if (!Number.isInteger(qualifiersPerGroup) || qualifiersPerGroup < 1) {
    return 'Из группы должен выходить хотя бы 1 участник';
  }
  if (qualifiersPerGroup >= participantsPerGroup) {
    return 'Из группы должно выходить меньше участников, чем в ней играет';
  }
  if (groupsCount * qualifiersPerGroup < 2) {
    return 'В плей-офф должно выходить минимум 2 участника';
  }
  return null;
}

// Double elimination requires between 8 and 128 participants.
export const DOUBLE_ELIMINATION_MIN_PARTICIPANTS = 8;
export const DOUBLE_ELIMINATION_MAX_PARTICIPANTS = 128;

/**
 * Validate a double-elimination participant count. Returns a Russian error
 * string or null if valid. Dependency-free (shared by the bracket generator
 * and the tournament service).
 */
export function validateDoubleEliminationSize(count: number): string | null {
  if (
    count < DOUBLE_ELIMINATION_MIN_PARTICIPANTS ||
    count > DOUBLE_ELIMINATION_MAX_PARTICIPANTS
  ) {
    return (
      `Double elimination поддерживает ` +
      `${String(DOUBLE_ELIMINATION_MIN_PARTICIPANTS)}–${String(DOUBLE_ELIMINATION_MAX_PARTICIPANTS)} ` +
      `участников. Текущее количество: ${String(count)}`
    );
  }
  return null;
}

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
