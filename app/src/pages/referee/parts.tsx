// Общие блоки судейского пульта: каркас страницы, карточки, баннеры, строка
// матча и диалог подтверждения. Тёмная тема, mobile-first: крупные цели
// касания (кнопки ≥ 44px), без window.confirm (ненадёжен в WebView Telegram).
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MatchStatusBadge } from '@cue-bot/ui';
import AppModal from '../../components/AppModal.tsx';
import { Btn } from '../../components/controls.tsx';
import { ErrorBox } from '../../components/ui.tsx';
import type { AppMatch } from '../../lib/types.ts';
import { slotName } from '../../lib/refereeLogic.ts';

export function Page({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '16px 16px 24px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {children}
    </div>
  );
}

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      style={{
        alignSelf: 'flex-start',
        fontSize: 14,
        color: 'var(--text-muted)',
        textDecoration: 'none',
        padding: '6px 0',
      }}
    >
      ← {label}
    </Link>
  );
}

export function SectionTitle({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
        }}
      >
        {children}
      </div>
      {hint && (
        <div
          style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45 }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

export function Card({
  children,
  tone,
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: tone ? `var(--color-tone-${tone}-bg)` : 'var(--surface-2)',
        border: `1px solid ${tone ? `var(--color-tone-${tone}-fg)` : 'var(--border-subtle)'}`,
        borderRadius: 14,
        padding: 14,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export type Tone = 'warning' | 'danger' | 'success' | 'info';

/** Цветной блок-пояснение: заголовок + текст. */
export function Banner({
  tone,
  title,
  children,
}: {
  tone: Tone;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card tone={tone} style={{ gap: 6 }}>
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: `var(--color-tone-${tone}-fg)`,
        }}
      >
        {title}
      </span>
      {children && (
        <span
          style={{
            fontSize: 13,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          {children}
        </span>
      )}
    </Card>
  );
}

/** Маленькая плашка-счётчик / пометка. */
export function Pill({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background: tone
          ? `var(--color-tone-${tone}-bg)`
          : 'var(--surface-inset)',
        color: tone ? `var(--color-tone-${tone}-fg)` : 'var(--text-muted)',
        border: `1px solid ${tone ? `var(--color-tone-${tone}-fg)` : 'var(--border-subtle)'}`,
      }}
    >
      {children}
    </span>
  );
}

/** Ряд кнопок, переносящийся на узком экране. */
export function Actions({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
  );
}

/**
 * Строка матча-ссылка в пульт: игроки, счёт, статус и произвольные пометки
 * (стадия, стол, причины блокировки).
 */
export function MatchLink({
  match,
  notes,
  right,
}: {
  match: AppMatch;
  notes?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Link
      to={`/referee/m/${match.id}`}
      className="cb-card-link"
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 56,
        background: 'var(--surface-2)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 14,
        padding: '11px 14px',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          minWidth: 0,
          flex: 1,
        }}
      >
        <MatchPlayers match={match} />
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'var(--text-faint)',
          }}
        >
          {notes}
        </div>
      </div>
      {right ?? <MatchStatusBadge status={match.status} />}
    </Link>
  );
}

/**
 * Игроки матча в две строки (имя + счёт) — на узком экране имена в одну
 * строку «A — B» обрезаются до нечитаемого.
 */
export function MatchPlayers({ match }: { match: AppMatch }) {
  const hasScore = match.player1Score != null && match.player2Score != null;
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
    >
      {([1, 2] as const).map((slot) => {
        const id = slot === 1 ? match.player1Id : match.player2Id;
        const won = id !== null && match.winnerId === id;
        return (
          <div
            key={slot}
            style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}
          >
            <span
              style={{
                ...ellipsis,
                flex: 1,
                fontSize: 15,
                fontWeight: won ? 700 : 600,
                color: id ? 'var(--text-primary)' : 'var(--text-faint)',
              }}
            >
              {slotName(match, slot)}
            </span>
            {hasScore && (
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: won ? 'var(--text-primary)' : 'var(--text-faint)',
                }}
              >
                {slot === 1 ? match.player1Score : match.player2Score}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const ellipsis: CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** Диалог подтверждения необратимого действия судьи. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  pending,
  confirmDisabled = false,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending: boolean;
  /** Подтверждение пока невозможно (не всё выбрано). */
  confirmDisabled?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AppModal onClose={onClose} maxWidth={420}>
      <div
        style={{
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
        {children && (
          <div
            style={{
              fontSize: 14,
              color: 'var(--text-muted)',
              lineHeight: 1.55,
            }}
          >
            {children}
          </div>
        )}
        {error && <ErrorBox message={error} />}
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn variant="ghost" block disabled={pending} onClick={onClose}>
            Отмена
          </Btn>
          <Btn
            variant={danger ? 'solid-danger' : 'primary'}
            block
            disabled={pending || confirmDisabled}
            onClick={onConfirm}
          >
            {pending ? 'Отправка…' : confirmLabel}
          </Btn>
        </div>
      </div>
    </AppModal>
  );
}
