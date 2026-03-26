import type { CREATION_STEPS } from './tournamentCreation.const.ts';
import type { Venue } from '../@types/venue.js';
import type { Tournament } from '../@types/tournament.js';
import type { Table } from '../@types/table.js';

// #region Types / Interfaces

export type ICreationStep = (typeof CREATION_STEPS)[number];

export interface ICreationData {
  venue?: Pick<Venue, 'id' | 'name'>;

  tournament?: Partial<
    Pick<
      Tournament,
      | 'id'
      | 'name'
      | 'startDate'
      | 'discipline'
      | 'format'
      | 'maxParticipants'
      | 'winScore'
    >
  >;

  tableIds?: Pick<Table, 'id' | 'name'>[];
}

export interface ICreationState {
  step: ICreationStep;
  data: ICreationData;
}

// #endregion
