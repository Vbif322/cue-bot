/**
 * Парсит дату и время из строки.
 * Поддерживаемые форматы даты: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
 * Также поддерживается год из двух цифр (DD/MM/YY и т.д.)
 * Время (опционально): HH:MM или HH:MM:SS
 * @returns Date или null если формат невалидный
 */
export function parseDate(input: string): Date | null {
  const trimmed = input.trim();

  // Регулярка для даты с опциональным временем
  // Группы: 1-день, 2-месяц, 3-год, 5-часы, 6-минуты, 8-секунды
  const match = trimmed.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})(\s+(\d{1,2}):(\d{2})(:(\d{2}))?)?$/
  );

  if (!match) {
    return null;
  }

  const day = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  let year = parseInt(match[3]!, 10);

  // Время (по умолчанию 10:00)
  const hours = match[5] ? parseInt(match[5], 10) : 0;
  const minutes = match[6] ? parseInt(match[6], 10) : 0;

  // Если год двузначный, преобразуем в четырёхзначный
  if (year < 100) {
    year += 2000;
  }

  // Валидация даты
  if (month < 1 || month > 12) {
    return null;
  }

  if (day < 1 || day > 31) {
    return null;
  }

  // Валидация времени
  if (hours < 0 || hours > 23) {
    return null;
  }

  if (minutes < 0 || minutes > 59) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes));

  // Проверка что дата корректна (например, 31 февраля станет 3 марта)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}
