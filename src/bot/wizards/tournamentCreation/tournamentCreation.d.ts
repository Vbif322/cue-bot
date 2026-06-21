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
      | 'groupsCount'
      | 'participantsPerGroup'
      | 'qualifiersPerGroup'
      | 'groupDraw'
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
    // mergeRound (double_elimination) and the group config (groups_playoff) are
    // collected only for their formats; optional here.
    Partial<
      Pick<
        Tournament,
        | 'mergeRound'
        | 'groupsCount'
        | 'participantsPerGroup'
        | 'qualifiersPerGroup'
        | 'groupDraw'
      >
    >;
}

export interface ICreationState {
  step: ICreationStep;
  data: ICreationData;
}

// #endregion
