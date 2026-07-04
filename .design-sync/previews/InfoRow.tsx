import { InfoRow, TournamentStatusBadge } from '@cue-bot/ui';

// A metadata card — InfoRow's canonical use (label/value rows, values may be
// plain text or other components).
export function TournamentMeta() {
  return (
    <div
      style={{
        maxWidth: 440,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <InfoRow label="Статус" value={<TournamentStatusBadge status="in_progress" />} />
      <InfoRow label="Формат" value="Одиночное выбывание" />
      <InfoRow label="Видимость" value="Публичный" />
      <InfoRow label="Участники" value="16 из 16" />
      <InfoRow label="Win score" value="7" />
      <InfoRow label="Дата начала" value="15.05.2024, 18:00" />
    </div>
  );
}
