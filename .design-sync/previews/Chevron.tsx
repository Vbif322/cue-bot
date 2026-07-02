import { Chevron } from '@cue-bot/ui';

// The two states side by side (collapsed points right, expanded rotates 90°).
export function States() {
  return (
    <div style={{ display: 'flex', gap: 32, alignItems: 'center', color: '#374151', fontSize: 14 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Chevron collapsed={true} /> Свёрнуто
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Chevron collapsed={false} /> Развёрнуто
      </span>
    </div>
  );
}

// In situ: a collapsible section header, as used in the bracket view.
export function SectionHeader() {
  return (
    <button
      type="button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontWeight: 600,
        color: '#111827',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 15,
        padding: 0,
      }}
    >
      <Chevron collapsed={false} />
      <span>Верхняя сетка</span>
    </button>
  );
}
