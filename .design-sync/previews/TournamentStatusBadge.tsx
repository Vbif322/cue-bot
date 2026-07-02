import { TournamentStatusBadge } from '@cue-bot/ui';

const STATUSES = [
  'draft',
  'registration_open',
  'registration_closed',
  'in_progress',
  'completed',
  'cancelled',
] as const;

// Every tournament lifecycle status, each with its localized label + tone.
export function AllStatuses() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {STATUSES.map((s) => (
        <TournamentStatusBadge key={s} status={s} />
      ))}
    </div>
  );
}
