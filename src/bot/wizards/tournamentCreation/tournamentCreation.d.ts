import type { CREATION_STEPS } from './tournamentCreation.const.js';
import type { Venue } from '../../@types/venue.js';
import type { Tournament } from '../../@types/tournament.js';
import type { Table } from '../../@types/table.js';

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
      | 'visibility'
      | 'scheduleMode'
      | 'discipline'
      | 'format'
      | 'randomAdvancement'
      | 'maxParticipants'
      | 'mergeRound'
      | 'winScore'
    >
  >;

  tables?: Pick<Table, 'id' | 'name'>[];
}

export interface IRequiredCreationData extends Required<ICreationData> {
  tournament: Required<
    Pick<
      Tournament,
      | 'id'
      | 'name'
      | 'startDate'
      | 'visibility'
      | 'scheduleMode'
      | 'discipline'
      | 'format'
      | 'randomAdvancement'
      | 'maxParticipants'
      | 'winScore'
    >
  > &
    // mergeRound is only collected for double_elimination; optional here.
    Partial<Pick<Tournament, 'mergeRound'>>;
}

export interface ICreationState {
  step: ICreationStep;
  data: ICreationData;
}

// #endregion
