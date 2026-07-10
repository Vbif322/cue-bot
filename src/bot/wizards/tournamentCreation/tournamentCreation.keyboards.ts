import { InlineKeyboard } from 'grammy';

import {
  sports,
  SPORT_DISCIPLINES,
  maxParticipants,
  formats,
  scheduleModes,
  validMergeRoundsForSize,
  visibilities,
  winScores,
  groupsCountOptions,
  participantsPerGroupOptions,
  qualifiersOptionsForGroupSize,
} from '@/db/schema/tournaments.js';
import type { ITournamentSport } from '@/db/schema/tournaments.js';
import {
  formatDiscipline,
  formatFormat,
  formatScheduleMode,
  formatSport,
  formatVisibility,
} from '@/utils/constants.js';

import type { Venue } from '../../@types/venue.js';
import type { Table } from '../../@types/table.js';

// #region Types / Interfaces

export interface ITournamentCreationKeyboards {
  buildVenuesKeyboard(
    venues: Pick<Venue, 'id' | 'name'>[],
  ): InlineKeyboard;
  buildVisibilityKeyboard(): InlineKeyboard;
  buildScheduleModeKeyboard(): InlineKeyboard;
  buildSportKeyboard(): InlineKeyboard;
  buildDisciplineKeyboard(sport: ITournamentSport): InlineKeyboard;
  buildFormatKeyboard(): InlineKeyboard;
  buildRandomModeKeyboard(): InlineKeyboard;
  buildParticipantsKeyboard(): InlineKeyboard;
  buildMergeRoundKeyboard(maxParticipants: number): InlineKeyboard;
  buildGroupsCountKeyboard(): InlineKeyboard;
  buildParticipantsPerGroupKeyboard(): InlineKeyboard;
  buildQualifiersPerGroupKeyboard(participantsPerGroup: number): InlineKeyboard;
  buildGroupDrawKeyboard(): InlineKeyboard;
  buildWinScoreKeyboard(): InlineKeyboard;
  buildTablesKeyboard(
    tables: Pick<Table, 'id' | 'name'>[],
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
    venues: Pick<Venue, 'id' | 'name'>[],
  ): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const venue of venues) {
      keyboard.text(venue.name, `tc:venue:${venue.id}`).row();
    }

    return keyboard;
  }

  /**
   * Создает клавиатуру для выбора видимости турнира
   *
   * @returns {InlineKeyboard} Клавиатура с вариантами видимости и коллбеком 'tc:visibility:<visibility>' для каждой кнопки
   */
  buildVisibilityKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const visibility of visibilities) {
      keyboard
        .text(formatVisibility(visibility), `tc:visibility:${visibility}`)
        .row();
    }

    return keyboard;
  }

  /**
   * Создает клавиатуру для выбора режима расписания турнира
   *
   * @returns {InlineKeyboard} Клавиатура с вариантами режима и коллбеком 'tc:schedule:<mode>' для каждой кнопки
   */
  buildScheduleModeKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const mode of scheduleModes) {
      keyboard.text(formatScheduleMode(mode), `tc:schedule:${mode}`).row();
    }

    return keyboard;
  }

  /**
   * Создает клавиатуру для выбора вида бильярда
   *
   * @returns {InlineKeyboard} Клавиатура с названиями видов и коллбеком 'tc:sport:<sport>' для каждой кнопки
   */
  buildSportKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const sport of sports) {
      keyboard.text(formatSport(sport), `tc:sport:${sport}`).row();
    }

    return keyboard;
  }

  /**
   * Создает клавиатуру для выбора дисциплины турнира внутри выбранного вида
   *
   * @param {ITournamentSport} sport Вид бильярда, дисциплины которого показываются
   *
   * @returns {InlineKeyboard} Клавиатура с названиями дисциплин и коллбеком 'tc:discipline:<discipline>' для каждой кнопки
   */
  buildDisciplineKeyboard(sport: ITournamentSport): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const discipline of SPORT_DISCIPLINES[sport]) {
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

  /** Groups count picker → callback 'tc:groups:<n>'. */
  buildGroupsCountKeyboard(perRow = 3): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    groupsCountOptions.forEach((v, i) => {
      keyboard.text(String(v), `tc:groups:${String(v)}`);
      if ((i + 1) % perRow === 0) keyboard.row();
    });
    return keyboard;
  }

  /** Participants-per-group picker → callback 'tc:ppg:<n>'. */
  buildParticipantsPerGroupKeyboard(perRow = 4): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    participantsPerGroupOptions.forEach((v, i) => {
      keyboard.text(String(v), `tc:ppg:${String(v)}`);
      if ((i + 1) % perRow === 0) keyboard.row();
    });
    return keyboard;
  }

  /** Qualifiers-per-group picker (1..size-1) → callback 'tc:qpg:<n>'. */
  buildQualifiersPerGroupKeyboard(
    participantsPerGroup: number,
    perRow = 4,
  ): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    qualifiersOptionsForGroupSize(participantsPerGroup).forEach((v, i) => {
      keyboard.text(String(v), `tc:qpg:${String(v)}`);
      if ((i + 1) % perRow === 0) keyboard.row();
    });
    return keyboard;
  }

  /** Group draw picker → callback 'tc:draw:<snake|random>'. */
  buildGroupDrawKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('Змейкой (по сеяным)', 'tc:draw:snake')
      .row()
      .text('Случайно', 'tc:draw:random');
  }

  /**
   * Создает клавиатуру для выбора режима случайных пар (рандом)
   *
   * @returns {InlineKeyboard} Клавиатура с кнопками "Да"/"Нет" и коллбеком 'tc:random:<true|false>'
   */
  buildRandomModeKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('Да', 'tc:random:true')
      .text('Нет', 'tc:random:false');
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
      keyboard.text(String(v), `tc:participants:${String(v)}`);

      if ((i + 1) % perRow === 0) {
        keyboard.row();
      }
    });

    return keyboard;
  }

  /**
   * Создает клавиатуру для выбора раунда объединения (double elimination)
   *
   * @param {number} maxParticipants Лимит участников (определяет допустимые раунды)
   * @param {number} [perRow=3] Количество кнопок в строке (3 по умолчанию)
   *
   * @returns {InlineKeyboard} Клавиатура с номерами раундов и коллбеком 'tc:merge:<number>'
   */
  buildMergeRoundKeyboard(maxParticipants: number, perRow = 3): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    const rounds = validMergeRoundsForSize(maxParticipants);
    const lastRound = rounds[rounds.length - 1];

    rounds.forEach((m, i) => {
      const label = m === lastRound ? `${String(m)} (полный DE)` : String(m);
      keyboard.text(label, `tc:merge:${String(m)}`);

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
      keyboard.text(String(v), `tc:winscore:${String(v)}`);

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
    tables: Pick<Table, 'id' | 'name'>[],
    selectedTableIds: string[],
  ): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    const selectedSet = new Set(selectedTableIds);

    for (const table of tables) {
      const isSelected = selectedSet.has(table.id);

      const label = `${isSelected ? '✅' : '⬜'} ${table.name}`;

      keyboard.text(label, `tc:tables_toggle:${table.id}`).row();
    }

    const allSelected =
      tables.length > 0 && tables.every((t) => selectedSet.has(t.id));
    keyboard.text(`${allSelected ? '✅' : '⬜'} Все`, 'tc:tables_all').row();

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
