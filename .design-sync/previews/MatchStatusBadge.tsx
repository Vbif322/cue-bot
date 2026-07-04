import { MatchStatusBadge } from '@cue-bot/ui';

const STATUSES = [
  'scheduled',
  'in_progress',
  'pending_confirmation',
  'completed',
  'cancelled',
] as const;

// Every match lifecycle status, each with its localized label + tone.
export function AllStatuses() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {STATUSES.map((s) => (
        <MatchStatusBadge key={s} status={s} />
      ))}
    </div>
  );
}
