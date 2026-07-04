// Мелкие презентационные блоки тёмной темы (по макетам Claude Design).
import type { ReactNode } from 'react';
import { gradientFor, initials } from '../lib/format.ts';

interface AvatarProps {
  person?: { name?: string | null; surname?: string | null; username?: string | null } | null;
  gradientKey?: string | null;
  label?: string;
  size?: number;
  you?: boolean;
}

/** Круглый аватар-инициалы с детерминированным градиентом. */
export function Avatar({ person, gradientKey, label, size = 32, you = false }: AvatarProps) {
  const text = label ?? initials(person);
  const bg = you ? 'linear-gradient(135deg,#3b82f6,#8b5cf6)' : gradientFor(gradientKey ?? text);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.36),
        fontWeight: 700,
        color: '#fff',
        background: bg,
      }}
    >
      {text}
    </span>
  );
}

/** Тонкий прогресс-бар заполнения (0–100). */
export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      style={{
        height: 6,
        borderRadius: 999,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: 999,
          background: 'var(--color-primary)',
          width: `${percent}%`,
          transition: 'width 0.3s ease',
        }}
      />
    </div>
  );
}

/** Крупная стат-карточка (значение + подпись). */
export function StatTile({
  value,
  label,
  color,
}: {
  value: ReactNode;
  label: string;
  color?: string;
}) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        background: '#17181e',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 14,
        padding: 16,
      }}
    >
      <span
        style={{
          fontSize: 28,
          fontWeight: 700,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          color: color ?? '#f3f4f6',
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 12, color: '#6b7280' }}>{label}</span>
    </div>
  );
}

/** Пустое состояние с иконкой-кружком, заголовком и подписью. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 14,
        padding: '64px 24px',
      }}
    >
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 18,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #3a3f49' }} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
      {hint && (
        <div style={{ fontSize: 14, color: '#6b7280', maxWidth: 320 }}>{hint}</div>
      )}
      {action}
    </div>
  );
}

/** Центрированный спиннер загрузки. */
export function Loader({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        color: '#6b7280',
        fontSize: 14,
      }}
    >
      {label}
    </div>
  );
}

/** Тёмный алерт ошибки (сообщение API по-русски). */
export function ErrorBox({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(220,38,38,0.08)',
        border: '1px solid rgba(248,113,113,0.35)',
        color: '#fca5a5',
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      {message}
    </div>
  );
}
