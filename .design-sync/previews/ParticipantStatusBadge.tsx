import { ParticipantStatusBadge } from '@cue-bot/ui';

// The three known statuses render as tone pills.
export function KnownStatuses() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <ParticipantStatusBadge status="pending" />
      <ParticipantStatusBadge status="confirmed" />
      <ParticipantStatusBadge status="cancelled" />
    </div>
  );
}

// An unrecognized status degrades to plain grey text rather than a pill.
export function UnknownStatus() {
  return <ParticipantStatusBadge status="withdrawn" />;
}
