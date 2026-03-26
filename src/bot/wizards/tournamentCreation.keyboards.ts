import { InlineKeyboard } from 'grammy';

import { DISCIPLINE_LABELS, FORMAT_LABELS } from '@/utils/constants.js';
import { discipline, tournamentFormat } from '@/db/schema/tournaments.js';

import type { Venue } from '../@types/venue.js';
import type { Table } from '../@types/table.js';

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
  buildVenuesKeyboard(
    venues: Array<Pick<Venue, 'id' | 'name'>>,
  ): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const venue of venues) {
      keyboard.text(venue.name, `venue:${venue.id}`).row();
    }

    return keyboard;
  }

  buildDisciplineKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const disc of discipline) {
      keyboard
        .text(DISCIPLINE_LABELS[disc] ?? disc, `discipline:${disc}`)
        .row();
    }

    return keyboard;
  }

  buildFormatKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (const format of tournamentFormat) {
      keyboard.text(FORMAT_LABELS[format] ?? format, `format:${format}`).row();
    }

    return keyboard;
  }

  buildParticipantsKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('8', 'participants:8')
      .text('16', 'participants:16')
      .text('32', 'participants:32')
      .row()
      .text('64', 'participants:64')
      .text('128', 'participants:128');
  }

  buildWinScoreKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('До 2 побед', 'winscore:2')
      .text('До 3 побед', 'winscore:3')
      .row()
      .text('До 4 побед', 'winscore:4')
      .text('До 5 побед', 'winscore:5');
  }

  buildTablesKeyboard(
    tables: Array<Pick<Table, 'id' | 'name'>>,
    selectedTableIds: string[],
  ): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    const selectedSet = new Set(selectedTableIds);

    for (const table of tables) {
      const isSelected = selectedSet.has(table.id);

      const label = `${isSelected ? '✅' : '⬜'} ${table.name}`;

      keyboard.text(label, `tables_toggle:${table.id}`).row();
    }

    keyboard.text('Готово', 'tables_done');
    keyboard.text('Пропустить', 'tables_skip');

    return keyboard;
  }

  buildTablesSkipOnlyKeyboard(): InlineKeyboard {
    return new InlineKeyboard().text('Завершить', 'tables_skip');
  }

  buildTournamentCreatedKeyboard(tournamentId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('Открыть регистрацию', `tournament_open_reg:${tournamentId}`)
      .row();
  }
}

// #endregion
