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
  'winScore',
  'tables',
] as const;

// `randomMode` is an unnumbered sub-choice shown only for elimination formats
// (round_robin skips it), so it is excluded from the user-facing step count to
// keep the existing "Шаг N / M" numbering intact.
export const STEPS_COUNT = CREATION_STEPS.length - 1;
