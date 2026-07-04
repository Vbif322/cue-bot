// Тёмная оболочка модалки (макеты match-detail и подтверждающие диалоги).
// @cue-bot/ui Modal светлый (используется админкой) — здесь своя тёмная панель;
// внутри переиспользуем @cue-bot/ui Button/Badge и т.п.
import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface AppModalProps {
  onClose: () => void;
  children: ReactNode;
  /** Заголовок стандартной шапки. Если не задан — шапку рендерит caller внутри children. */
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Слот слева от кнопки закрытия (например статус-бейдж матча). */
  rightSlot?: ReactNode;
  maxWidth?: number;
}

export default function AppModal({
  onClose,
  children,
  title,
  subtitle,
  rightSlot,
  maxWidth = 560,
}: AppModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(3,4,8,0.66)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '24px 16px',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      <div
        className="cb-scroll"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth,
          boxSizing: 'border-box',
          background: '#15161c',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 20,
          boxShadow: '0 24px 70px rgba(0,0,0,0.6)',
          overflow: 'hidden',
          margin: 'auto',
        }}
      >
        {title !== undefined && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '16px 18px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12, color: '#6b7280' }}>{subtitle}</div>}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              {rightSlot}
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: 'rgba(255,255,255,0.04)',
                  color: '#9aa0aa',
                  fontSize: 15,
                  cursor: 'pointer',
                  flex: 'none',
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
