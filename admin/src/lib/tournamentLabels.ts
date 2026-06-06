// Single source of truth for tournament display labels (Russian UI strings),
// keyed off the central schema-derived types from @server/apiTypes.
import type {
  ITournamentFormat,
  TournamentVisibility,
  TournamentScheduleMode,
} from '@server/apiTypes';

export const FORMAT_LABELS: Record<ITournamentFormat, string> = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  double_elimination_random: 'Double Elimination (random)',
  round_robin: 'Round Robin',
};

/** Compact variant used in dense list views. */
export const FORMAT_LABELS_SHORT: Record<ITournamentFormat, string> = {
  single_elimination: 'Single Elim.',
  double_elimination: 'Double Elim.',
  double_elimination_random: 'Double Elim. (random)',
  round_robin: 'Round Robin',
};

export const VISIBILITY_LABELS: Record<TournamentVisibility, string> = {
  public: 'Открытый',
  private: 'Закрытый (по приглашению)',
};

export const SCHEDULE_MODE_LABELS: Record<TournamentScheduleMode, string> = {
  single_day: 'Один день',
  per_match: 'По матчам',
};
