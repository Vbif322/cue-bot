import { Badge } from '@cue-bot/ui';

// The full tone palette — the primary variant axis.
export function Tones() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <Badge tone="neutral">Нейтральный</Badge>
      <Badge tone="muted">Приглушённый</Badge>
      <Badge tone="success">Успех</Badge>
      <Badge tone="warning">Внимание</Badge>
      <Badge tone="info">Инфо</Badge>
      <Badge tone="accent">Акцент</Badge>
      <Badge tone="danger">Опасно</Badge>
    </div>
  );
}

// Inline within running text, its most common placement.
export function Inline() {
  return (
    <span style={{ fontSize: 14, color: '#374151', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      Турнир «Весенний кубок» <Badge tone="success">Регистрация открыта</Badge>
    </span>
  );
}
