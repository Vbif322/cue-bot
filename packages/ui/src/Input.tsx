import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';

const FIELD_BASE =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

/** Текстовый инпут с общим focus-ring. Пробрасывает нативные props. */
export function Input({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_BASE} ${className}`} {...rest} />;
}

/** Select с той же рамкой/focus-ring, что и Input. */
export function Select({
  className = '',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${FIELD_BASE} ${className}`} {...rest} />;
}
