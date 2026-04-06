import { InlineKeyboard } from 'grammy';

import {
  disciplines,
  maxParticipants,
  formats,
  winScores,
} from '@/db/schema/tournaments.js';
import { formatDiscipline, formatFormat } from '@/utils/constants.js';

import type { Venue } from '../../@types/venue.js';
import type { Table } from '../../@types/table.js';

// #region Types / Interfaces

export interface ITournamentCreationKeyboards {
  buildVenuesKeyboard(
    venues: Array<Pick<Venue, 'id' | 'name'>>,
  ): InlineKeyboard;
  buildDisciplineKeyboard(): InlineKeyboard;
  buildFormatKeyboard(): InlineKeyboard;
  buildParticipantsKeyboard(): InlineKeyboard;
  buildWinScoreKeyboard(): InlineKeyboard;
  buildTablesKeyboard(
    tables: Array<Pick<Table, 'id' | 'name'>>,
    selectedTableIds: string[],
  ): InlineKeyboard;

  buildTablesSkipOnlyKeyboard(): InlineKeyboard;
  buildTournamentCreatedKeyboard(tournamentId: string): InlineKeyboard;
}

// #endregion

// #region Class

/** Обработка клавиатуры */
export class TournamentCreationKeyboards implements ITournamentCreationKeyboards {
  /**
   * Создает клавиатуру для выбора места проведения турнира
   *
   * @param {Array<Pick<Venue, 'id' | 'name'>>} venues Array of venues to display
   *
   * @returns {InlineKeyboard} Клавиатура с названиями площадок и коллбеком 'venue:<id>' для каждой кнопки
   */
  buildVenuesKeyboard(
    venues: Array<Pick<Venue, 'id' | 'name'>>,
  ): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const venue of venues) {
      keyboard.text(venue.name, `tc:venue:${venue.id}`).row();
    }

    return keyboard;
  }

  /**
   * Создает клавиатуру для выбора дисциплины турнира
   *
   * @returns {InlineKeyboard} Клавиатура с названиями дисциплин и коллбеком 'discipline:<discipline>' для каждой кнопки
   */
  buildDisciplineKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const discipline of disciplines) {
      keyboard
        .text(formatDiscipline(discipline), `tc:discipline:${discipline}`)
        .row();
    }

    return keyboard;
  }

  /**
   * Создает клавиатуру для выбора формата турнира
   *
   * @returns {InlineKeyboard} Клавиатура с названиями форматов и коллбеком 'format:<format>' для каждой кнопки
   */
  buildFormatKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const format of formats) {
      keyboard.text(formatFormat(format), `tc:format:${format}`).row();
    }

    return keyboard;
  }

  /**
   * Создает клавиатуру для выбора максимального количества участников
   *
   * @param {number} [perRow=3] Количество кнопок, отображаемых в строке (3 по умолчанию)
   *
   * @returns {InlineKeyboard} Клавиатура с числами участников и коллбеком 'participants:<number>' для каждой кнопки
   */
  buildParticipantsKeyboard(perRow = 3): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    maxParticipants.forEach((v, i) => {
      keyboard.text(String(v), `tc:participants:${v}`);

      if ((i + 1) % perRow === 0) {
        keyboard.row();
      }
    });

    return keyboard;
  }

  /**
   * Создает клавиатуру для выбора счета для победы
   *
   * @param {number} [perRow=2] Количество кнопок, отображаемых в строке (2 по умолчанию)
   *
   * @returns {InlineKeyboard} Клавиатура с числами счета и коллбеком 'winscore:<number>' для каждой кнопки
   */
  buildWinScoreKeyboard(perRow = 2): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    winScores.forEach((v, i) => {
      keyboard.text(String(v), `tc:winscore:${v}`);

      if ((i + 1) % perRow === 0) {
        keyboard.row();
      }
    });

    return keyboard;
  }

  /**
   * Создает клавиатуру для выбора столов для создаваемого турнира
   *
   * @param {Array<Pick<Table, 'id' | 'name'>>} tables Массив таблиц для отображения
   * @param {string[]} selectedTableIds Массив выбранных идентификаторов таблиц
   *
   * @returns {InlineKeyboard} Клавиатура с кнопками для каждого стола
   * и коллбеком 'tables_toggle:<id>' для переключения выбора,
   * а также кнопками "Готово" и "Пропустить"
   */
  buildTablesKeyboard(
    tables: Array<Pick<Table, 'id' | 'name'>>,
    selectedTableIds: string[],
  ): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    const selectedSet = new Set(selectedTableIds);

    for (const table of tables) {
      const isSelected = selectedSet.has(table.id);

      const label = `${isSelected ? '✅' : '⬜'} ${table.name}`;

      keyboard.text(label, `tc:tables_toggle:${table.id}`).row();
    }

    keyboard.text('Готово', 'tc:tables_done');
    keyboard.text('Пропустить', 'tc:tables_skip');

    return keyboard;
  }

  /**
   * Создает клавиатуру для пропуска шага выбора столов
   *
   * @returns {InlineKeyboard} Клавиатура с кнопкой "Пропустить" и коллбеком 'tables_skip'
   */
  buildTablesSkipOnlyKeyboard(): InlineKeyboard {
    return new InlineKeyboard().text('Завершить', 'tc:tables_skip');
  }

  /**
   * Создает клавиатуру для открытия регистрации турнира
   *
   * @param {string} tournamentId Идентификатор созданного турнира
   *
   * @returns {InlineKeyboard} Клавиатура с кнопкой "Открыть регистрацию" и коллбеком 'tournament_open_reg:<tournamentId>'
   */
  buildTournamentCreatedKeyboard(tournamentId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('Открыть регистрацию', `tournament_open_reg:${tournamentId}`)
      .row();
  }
}

// #endregion
