import { Select } from '@cue-bot/ui';

// Select with real options (same border/focus-ring as Input).
export function Default() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Select defaultValue="single_elimination">
        <option value="single_elimination">Одиночное выбывание</option>
        <option value="double_elimination">Двойное выбывание</option>
        <option value="round_robin">Круговая система</option>
      </Select>
    </div>
  );
}

// Disabled.
export function Disabled() {
  return (
    <div style={{ maxWidth: 340 }}>
      <Select disabled defaultValue="single_elimination">
        <option value="single_elimination">Одиночное выбывание</option>
      </Select>
    </div>
  );
}
