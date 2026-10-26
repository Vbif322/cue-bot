export const CREATION_STEPS = [
  'federation',
  'name',
  'date',
  'visibility',
  'scheduleMode',
  'venue',
  'sport',
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
  'stageWinScores',
  'tables',
] as const;

// `federation` (shown only to members of several federations), `randomMode`,
// `mergeRound`, `stageWinScores` and the four groups_playoff sub-steps
// (groupsCount, participantsPerGroup, qualifiersPerGroup, groupDraw) are
// unnumbered sub-choices shown only in some cases, so they are excluded from
// the user-facing step count to keep the existing "Шаг N / M" numbering intact.
export const STEPS_COUNT = CREATION_STEPS.length - 8;
