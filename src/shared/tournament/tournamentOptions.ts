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

// ── Per-stage match length (M2-11) ───────────────────────────────────────────
// A tournament's `winScore` is the baseline "race to N" for every match. Real
// tournaments lengthen the closing matches (final longer than the semis, and so
// on), so a tournament may override the length of the last few playoff stages.
//
// Stages are keyed FROM THE END of the bracket, never by absolute round number:
// the real bracket size is only frozen when registration closes
// (`confirmedParticipants`), so round 4 is the final in a 16-player draw but the
// semifinal in a 32-player one. Keying from the end keeps the organiser's intent
// stable whatever the turnout.
//
// Scope: the playoff side only (single elimination, the playoff phase of
// groups_playoff, and the winners side of double elimination). Group tours,
// round robin and the DE losers bracket always use the tournament `winScore`.
export const matchLengthStages = [
  'final',
  'semifinal',
  'quarterfinal',
] as const;

export type IMatchLengthStage = (typeof matchLengthStages)[number];

/** Distance from the last playoff round: 0 = final, 1 = semifinal, 2 = 1/4. */
export const MATCH_LENGTH_STAGE_BY_DISTANCE: readonly IMatchLengthStage[] = [
  'final',
  'semifinal',
  'quarterfinal',
];

export const MATCH_LENGTH_STAGE_LABELS: Record<IMatchLengthStage, string> = {
  final: 'Финал',
  semifinal: 'Полуфинал',
  quarterfinal: '1/4 финала',
};

/**
 * Per-stage overrides of the tournament `winScore`. A missing key means "use the
 * tournament's own winScore", so `{}` and `null` both mean "no overrides".
 */
export type IStageWinScores = Partial<
  Record<IMatchLengthStage, ITournamentWinScore>
>;

function isMatchLengthStage(value: string): value is IMatchLengthStage {
  return Object.values<string>(matchLengthStages).includes(value);
}

function isAllowedWinScore(value: unknown): value is ITournamentWinScore {
  return (
    typeof value === 'number' &&
    Object.values<number>(winScores).includes(value)
  );
}

/**
 * Validate a per-stage match-length map. Returns a Russian error string or null
 * if valid. Dependency-free so it is shared by the bot wizard, the admin zod
 * schema and the tournament service (mirrors `validateGroupConfig`).
 *
 * `null`/`undefined`/`{}` are valid and mean "no overrides".
 */
export function validateStageWinScores(cfg: unknown): string | null {
  if (cfg == null) return null;
  if (typeof cfg !== 'object' || Array.isArray(cfg)) {
    return 'Некорректная настройка длины матча по стадиям';
  }

  for (const [stage, value] of Object.entries(cfg)) {
    if (value === undefined) continue;
    if (!isMatchLengthStage(stage)) {
      return `Неизвестная стадия: ${stage}`;
    }
    if (!isAllowedWinScore(value)) {
      return (
        `Длина матча для стадии «${MATCH_LENGTH_STAGE_LABELS[stage]}» ` +
        `должна быть одной из: ${winScores.join(', ')}`
      );
    }
  }

  return null;
}

/**
 * Resolve the effective win score for a playoff round.
 *
 * `distanceFromLast` is `lastPlayoffRound - round`, so 0 is the final. Rounds
 * further from the end than the known stages, and any stage without an
 * override, fall back to the tournament `winScore`.
 */
export function winScoreForStageDistance(
  distanceFromLast: number,
  tournamentWinScore: number,
  stageWinScores: IStageWinScores | null | undefined,
): number {
  const stage = MATCH_LENGTH_STAGE_BY_DISTANCE[distanceFromLast];
  if (stage === undefined) return tournamentWinScore;
  return stageWinScores?.[stage] ?? tournamentWinScore;
}

/**
 * Human-readable summary of the per-stage overrides, ordered from the final
 * outwards: «Финал — до 5, Полуфинал — до 4». Returns null when nothing is
 * overridden, so callers can simply skip the line.
 */
export function formatStageWinScores(
  stageWinScores: IStageWinScores | null | undefined,
): string | null {
  if (stageWinScores == null) return null;

  const parts = MATCH_LENGTH_STAGE_BY_DISTANCE.flatMap((stage) => {
    const value = stageWinScores[stage];
    if (value === undefined) return [];
    return [`${MATCH_LENGTH_STAGE_LABELS[stage]} — до ${String(value)}`];
  });

  return parts.length > 0 ? parts.join(', ') : null;
}
