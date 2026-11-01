export const MAX_CITY_LENGTH = 100;

/**
 * Приводит введённый пользователем город к каноничному виду: обрезает края,
 * схлопывает пробелы, первая буква каждого слова — заглавная («санкт-петербург»
 * → «Санкт-Петербург»). Пустая строка → null. Сравнение городов в SQL всё равно
 * идёт без учёта регистра — нормализация нужна для единообразного показа.
 *
 * @throws {Error} если значение длиннее {@link MAX_CITY_LENGTH}.
 */
export function normalizeCity(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0) return null;
  if (collapsed.length > MAX_CITY_LENGTH) {
    throw new Error(`Город не длиннее ${String(MAX_CITY_LENGTH)} символов`);
  }
  return collapsed
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) =>
          part.length > 0
            ? part.charAt(0).toLocaleUpperCase('ru-RU') + part.slice(1)
            : part,
        )
        .join('-'),
    )
    .join(' ');
}
