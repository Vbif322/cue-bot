// Тёмные форм-контролы по макетам (кнопки/поля/чипы). Классы — в index.css.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';

type BtnVariant = 'primary' | 'danger' | 'solid-danger' | 'ghost';

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md';
  block?: boolean;
}

export function Btn({
  variant = 'primary',
  size = 'md',
  block = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: BtnProps) {
  const cls = [
    'cb-btn',
    `cb-btn-${variant}`,
    size === 'sm' ? 'cb-btn-sm' : '',
    block ? 'cb-btn-block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Field({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`cb-field ${className}`.trim()} {...rest} />;
}

export function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cb-chip ${active ? 'cb-chip-active' : ''}`.trim()}
    >
      {children}
    </button>
  );
}
