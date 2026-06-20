export const CREATION_STEPS = [
  'name',
  'date',
  'visibility',
  'scheduleMode',
  'venue',
  'discipline',
  'format',
  'randomMode',
  'maxParticipants',
  'mergeRound',
  'winScore',
  'tables',
] as const;

// `randomMode` and `mergeRound` are unnumbered sub-choices shown only for some
// formats (round_robin skips randomMode; only double_elimination shows
// mergeRound), so both are excluded from the user-facing step count to keep the
// existing "Шаг N / M" numbering intact.
export const STEPS_COUNT = CREATION_STEPS.length - 2;
