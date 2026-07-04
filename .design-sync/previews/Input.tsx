import { Input } from '@cue-bot/ui';

// Empty with placeholder — the default field.
export function Placeholder() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Input type="text" placeholder="Поиск по имени или @username..." />
    </div>
  );
}

// Filled.
export function WithValue() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Input type="text" defaultValue="Иван Петров" />
    </div>
  );
}

// Disabled (native attribute passthrough).
export function Disabled() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Input type="text" placeholder="Недоступно" disabled />
    </div>
  );
}
