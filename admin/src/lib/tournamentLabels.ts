// Single source of truth for tournament display labels (Russian UI strings),
// keyed off the central schema-derived types from @server/apiTypes.
import type {
  ITournamentFormat,
  TournamentStatus,
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

/**
 * Render the "Участники" value as `X / max`.
 *
 * While registration is still open (draft / registration_open) we show the LIVE
 * count from the participants table — the stored `confirmedParticipants` snapshot
 * is only written when registration closes, so it reads as 0 before that. Pending
 * registrations are shown separately. After close we fall back to the snapshot so
 * historical numbers stay stable (live counts can drift, e.g. disqualifications).
 */
export function formatParticipants(t: {
  status: TournamentStatus;
  confirmedCount: number;
  pendingCount: number;
  confirmedParticipants: number | null;
  maxParticipants: number;
}): string {
  if (t.status === 'draft' || t.status === 'registration_open') {
    const pending = t.pendingCount > 0 ? ` (+${t.pendingCount} ожидают)` : '';
    return `${t.confirmedCount}${pending} / ${t.maxParticipants}`;
  }
  return `${t.confirmedParticipants ?? t.confirmedCount} / ${t.maxParticipants}`;
}
