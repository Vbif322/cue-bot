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
  'groupsCount',
  'participantsPerGroup',
  'qualifiersPerGroup',
  'groupDraw',
  'winScore',
  'tables',
] as const;

// `randomMode`, `mergeRound` and the four groups_playoff sub-steps (groupsCount,
// participantsPerGroup, qualifiersPerGroup, groupDraw) are unnumbered sub-choices
// shown only for some formats, so they are excluded from the user-facing step
// count to keep the existing "Шаг N / M" numbering intact.
export const STEPS_COUNT = CREATION_STEPS.length - 6;
