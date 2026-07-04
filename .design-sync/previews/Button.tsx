import { Button } from '@cue-bot/ui';

// The three variants — the primary appearance axis.
export function Variants() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Button variant="primary">Сохранить</Button>
      <Button variant="secondary">Отмена</Button>
      <Button variant="destructive">Удалить</Button>
    </div>
  );
}

// The two sizes.
export function Sizes() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Button size="sm">Маленькая</Button>
      <Button size="md">Средняя</Button>
    </div>
  );
}

// Disabled state (native attribute passthrough).
export function Disabled() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Button variant="primary" disabled>
        Сохранить
      </Button>
      <Button variant="secondary" disabled>
        Отмена
      </Button>
    </div>
  );
}
