import type { ReactNode } from 'react';

/**
 * Каркас модалки: затемнённый оверлей + белая панель с шапкой и кнопкой закрытия.
 * Тело передаётся через children; ширину панели можно переопределить `maxWidthClassName`.
 */
export function Modal({
  title,
  onClose,
  children,
  maxWidthClassName = 'max-w-md',
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  maxWidthClassName?: string;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-xl shadow-xl w-full ${maxWidthClassName}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
