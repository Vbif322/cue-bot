import dayjs, { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(customParseFormat);

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
  'DD.MM.YYYY',
  'DD.MM.YYYY HH:mm',
  'DD.MM.YYYY HH:mm:ss',
  'DD.MM.YYYY HH:mm:ss.SSS',
  'DD.MM.YY',
  'DD.MM.YY HH:mm',
  'DD.MM.YY HH:mm:ss',

  'YYYY-MM-DD',
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DD HH:mm:ss.SSS',

  'DD-MM-YYYY',
  'DD-MM-YYYY HH:mm',
  'DD-MM-YYYY HH:mm:ss',
  'DD-MM-YY',
  'DD-MM-YY HH:mm',
  'DD-MM-YY HH:mm:ss',

  'DD/MM/YYYY',
  'DD/MM/YYYY HH:mm',
  'DD/MM/YYYY HH:mm:ss',
  'DD/MM/YY',
  'DD/MM/YY HH:mm',
  'DD/MM/YY HH:mm:ss',
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
   * @returns {{ status: true; datetime: Date } | { status: false }} Результат операции и объект Date
   */
  toDate(
    datetime: string,
  ): { status: true; datetime: Date } | { status: false } {
    const { status, datetime: parsedDatetime, hasTime } =
      this.parsedISO(datetime);

    if (!status) return { status: false };

    const result = hasTime
      ? parsedDatetime
      : parsedDatetime.hour(10).minute(0).second(0).millisecond(0);

    return { status: true, datetime: result.toDate() };
  }

  /**
   * Форматирует дату в соответствии с переданным форматом (в UTC).
   *
   * @param {Date} date Объект Date
   * @param {string} format Формат даты и времени (токены dayjs, напр. DD.MM.YYYY HH:mm)
   * @returns {string} Строка с форматированным значением даты и времени
   */
  formatDate(date?: Date | null, format = 'DD.MM.YYYY HH:mm'): string {
    if (date === null || date === undefined) {
      return 'Дата не указана';
    }

    return dayjs.utc(date).format(format);
  }

  /**
   * Преобразует строку с датой и временем в объект dayjs (в UTC), используя
   * следующие стратегии:
   * 1. Unix timestamp: seconds / milliseconds
   * 2. ISO 8601 (с учётом смещения / 'Z' в строке; без зоны — считается UTC)
   * 3. RFC 2822 / HTTP даты (содержат английское название месяца)
   * 4. Пользовательские форматы, включая ISO-дату и SQL (см. CUSTOM_FORMATS)
   *
   * Строка без зоны трактуется как UTC; результат всегда нормализуется к UTC.
   *
   * @param {string} datetime Строка с временным значением
   * @returns {{ status: true; datetime: Dayjs; hasTime: boolean } | { status: false }} Результат операции и объект dayjs (UTC)
   */
  private parsedISO(
    datetime: string,
  ):
    | { status: true; datetime: Dayjs; hasTime: boolean }
    | { status: false; datetime?: never; hasTime?: never } {
    const rawDatetime = datetime.trim();

    if (!rawDatetime) return { status: false };

    // 1) Unix timestamp: seconds / milliseconds — время всегда задано явно
    if (/^\d{10,13}$/.test(rawDatetime)) {
      const numDatetime = Number(rawDatetime);

      if (Number.isFinite(numDatetime)) {
        const parsedDatetime =
          rawDatetime.length === 10
            ? dayjs.unix(numDatetime)
            : dayjs(numDatetime);

        const normalized = this.toUTC(parsedDatetime);

        if (normalized) {
          return { status: true, datetime: normalized, hasTime: true };
        }
      }
    }

    // 2) ISO 8601 c временем — dayjs учитывает смещение/'Z' в строке,
    //    строка без зоны трактуется как UTC.
    if (/^\d{4}-\d{2}-\d{2}[T\s]\d{1,2}:\d{2}/.test(rawDatetime)) {
      const normalized = this.toUTC(dayjs.utc(rawDatetime));

      if (normalized) {
        return { status: true, datetime: normalized, hasTime: true };
      }
    }

    // 3) RFC 2822 / HTTP даты — содержат английское название месяца.
    //    Парсятся нативно; regex-страж гарантирует детерминизм для прочих строк.
    if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(rawDatetime)) {
      const normalized = this.toUTC(dayjs(new Date(rawDatetime)));

      if (normalized) {
        const hasTime = /\d{1,2}:\d{2}/.test(rawDatetime);

        return { status: true, datetime: normalized, hasTime };
      }
    }

    // 4) Кастомные форматы (строгий разбор в UTC), включая ISO-дату и SQL
    for (const fmt of CUSTOM_FORMATS) {
      const parsedDatetime = dayjs.utc(rawDatetime, fmt, true);

      if (parsedDatetime.isValid()) {
        return {
          status: true,
          datetime: parsedDatetime,
          hasTime: fmt.includes('HH'),
        };
      }
    }

    return { status: false };
  }

  /**
   * Нормализует объект dayjs к UTC.
   *
   * @param {Dayjs} datetime Исходный dayjs (например, с локальной или заданной зоной)
   * @returns {Dayjs | null} dayjs в UTC, если исходная дата валидна, иначе null
   */
  private toUTC(datetime: Dayjs): Dayjs | null {
    if (!datetime.isValid()) return null;

    return datetime.utc();
  }
}

// #endregion

// #region Global Instance

export const DateTimeHelperInstance = new DateTimeHelper();

// #endregion
