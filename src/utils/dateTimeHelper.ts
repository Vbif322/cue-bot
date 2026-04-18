import { DateTime } from 'luxon';

// #region Types / Interfaces

export interface IDateTimeHelper {
  toDate(
    datetime: string,
  ): { status: true; datetime: Date } | { status: false };

  formatDate(date?: Date | null, format?: string): string;
}

// #endregion

// #region Constants

const CUSTOM_FORMATS = [
  'dd.MM.yyyy',
  'dd.MM.yyyy HH:mm',
  'dd.MM.yyyy HH:mm:ss',
  'dd.MM.yyyy HH:mm:ss.SSS',
  'dd.MM.yy',
  'dd.MM.yy HH:mm',
  'dd.MM.yy HH:mm:ss',

  'yyyy-MM-dd',
  'yyyy-MM-dd HH:mm',
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-MM-dd HH:mm:ss.SSS',

  'dd-MM-yyyy',
  'dd-MM-yyyy HH:mm',
  'dd-MM-yyyy HH:mm:ss',
  'dd-MM-yy',
  'dd-MM-yy HH:mm',
  'dd-MM-yy HH:mm:ss',

  'dd/MM/yyyy',
  'dd/MM/yyyy HH:mm',
  'dd/MM/yyyy HH:mm:ss',
  'dd/MM/yy',
  'dd/MM/yy HH:mm',
  'dd/MM/yy HH:mm:ss',
] as const;

// #endregion

// #region Class

/** Обработка даты и времени */
export class DateTimeHelper implements IDateTimeHelper {
  /**
   * Преобразует строку с датой и временем в объект Date
   *
   * @param {string} datetime Строка с временным значением (числа, ISO, RFC 2822, HTTP, SQL, форматы DMY HMS)
   *
   * @returns {{ status: true; datetime: Date } | { status: false; datetime?: never }} Результат операции и объект Date
   */
  toDate(
    datetime: string,
  ): { status: true; datetime: Date } | { status: false } {
    const { status, datetime: parsedDatetime, hasTime } = this.parsedISO(datetime);

    if (!status) return { status: false };

    const result = hasTime
      ? parsedDatetime
      : parsedDatetime.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });

    return { status: true, datetime: result.toJSDate() };
  }

  /**
   * Форматирует строку с датой и временем в соответствии с переданным форматом
   *
   * @param {Date} date Объект Date
   * @param {string} format Формат даты и времени (Luxon поддерживает следующие форматы: ISO, RFC 2822, HTTP, SQL, а также пользовательские форматы)
   * @returns {string} Строка с форматированным значением даты и времени
   */
  formatDate(date?: Date | null, format: string = 'dd.LL.yyyy HH:mm'): string {
    if (date === null || date === undefined) {
      return 'Дата не указана';
    }

    return DateTime.fromJSDate(date, { zone: 'utc' }).toFormat(format);
  }

  /**
   * Преобразует строку с датой и временем в объект Luxon DateTime, используя следующие стратегии:
   * 1. Unix timestamp: seconds / milliseconds
   * 2. Стандартные Luxon форматы: ISO, RFC 2822, HTTP, SQL
   * 3. Пользовательские форматы (см. CUSTOM_FORMATS)
   *
   * defaultZone может иметь следующие значения:
   *  'utc' — строка уже в UTC
   *  'local' — локальное время процесса
   *  'Europe/Warsaw' и т.п. — считать временем конкретной зоны
   *
   * @param {string} datetime Строка с временным значением (числа, ISO, RFC 2822, HTTP, SQL, форматы DMY HMS)
   * @param {string} defaultZone Часовой пояс по умолчанию, используемый, если он не указан в строке с датой и временем
   * @returns {{ status: true; datetime: DateTime<true> } | { status: false; datetime?: never }} Результат операции и объект Luxon DateTime
   */
  private parsedISO(
    datetime: string,
    defaultZone: string = 'utc',
  ):
    | { status: true; datetime: DateTime<true>; hasTime: boolean }
    | { status: false; datetime?: never; hasTime?: never } {
    const rawDatetime = datetime.trim();

    if (!rawDatetime) return { status: false };

    // 1) Unix timestamp: seconds / milliseconds — время всегда задано явно
    if (/^\d{10,13}$/.test(rawDatetime)) {
      const numDatetime = Number(rawDatetime);

      if (Number.isFinite(numDatetime)) {
        const parsedDatetime =
          rawDatetime.length === 10
            ? DateTime.fromSeconds(numDatetime, { zone: 'utc' })
            : DateTime.fromMillis(numDatetime, { zone: 'utc' });

        const normalized = this.toUTC(parsedDatetime);

        if (normalized) return { status: true, datetime: normalized, hasTime: true };
      }
    }

    // 2) Стандартные форматы Luxon
    // setZone: true — если в строке есть смещение/зона, сохранить её при разборе
    const builtIn = [
      DateTime.fromISO(rawDatetime, { zone: defaultZone, setZone: true }),
      DateTime.fromRFC2822(rawDatetime, { zone: defaultZone, setZone: true }),
      DateTime.fromHTTP(rawDatetime, { zone: defaultZone, setZone: true }),
      DateTime.fromSQL(rawDatetime, { zone: defaultZone, setZone: true }),
    ];

    // Время считается заданным, если в строке есть цифры после пробела или символа T
    const builtInHasTime = /[\sT]\d{1,2}:/.test(rawDatetime);

    for (const parsedDatetime of builtIn) {
      const normalized = this.toUTC(parsedDatetime);

      if (normalized) return { status: true, datetime: normalized, hasTime: builtInHasTime };
    }

    // 3) Кастомные форматы
    for (const fmt of CUSTOM_FORMATS) {
      const parsedDatetime = DateTime.fromFormat(rawDatetime, fmt, {
        zone: defaultZone,
        setZone: true,
        locale: 'en',
      });

      const normalized = this.toUTC(parsedDatetime);

      if (normalized) return { status: true, datetime: normalized, hasTime: fmt.includes('HH') };
    }

    return { status: false };
  }

  /**
   * Преобразует объект DateTime в UTC.
   *
   * @param {DateTime} datetime - исходный DateTime (например, с локальной или заданной таймзоной)
   *
   * @returns {DateTime<true> | null} Новый DateTime в UTC, если исходная дата валидна, иначе null
   */
  private toUTC(datetime: DateTime): DateTime<true> | null {
    if (!datetime.isValid) return null;

    return datetime.toUTC() as DateTime<true>;
  }
}

// #endregion

// #region Global Instance

export const DateTimeHelperInstance = new DateTimeHelper();

// #endregion
