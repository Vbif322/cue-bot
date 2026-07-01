import type { ReactNode } from 'react';

export type BadgeTone =
  | 'neutral'
  | 'muted'
  | 'success'
  | 'warning'
  | 'info'
  | 'accent'
  | 'danger';

// Полные классы (не шаблонные строки) — чтобы сканер Tailwind их видел.
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-tone-neutral-bg text-tone-neutral-fg',
  muted: 'bg-tone-muted-bg text-tone-muted-fg',
  success: 'bg-tone-success-bg text-tone-success-fg',
  warning: 'bg-tone-warning-bg text-tone-warning-fg',
  info: 'bg-tone-info-bg text-tone-info-fg',
  accent: 'bg-tone-accent-bg text-tone-accent-fg',
  danger: 'bg-tone-danger-bg text-tone-danger-fg',
};

/** Статус-пилюля. Базовый примитив для всех бейджей статусов. */
export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
