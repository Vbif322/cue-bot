export const CREATION_STEPS = [
  'name',
  'date',
  'visibility',
  'scheduleMode',
  'venue',
  'discipline',
  'format',
  'maxParticipants',
  'winScore',
  'tables',
] as const;

export const STEPS_COUNT = CREATION_STEPS.length;
