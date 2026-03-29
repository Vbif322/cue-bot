import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';

import { TournamentCreationStateStore } from './tournamentCreation.stateStore.js';
import { TournamentCreationRenderer } from './tournamentCreation.renderer.js';
import { TournamentCreationFlow } from './tournamentCreation.flow.js';
import { TournamentCreationKeyboards } from './tournamentCreation.keyboards.js';

const tournamentCreationStateStore = new TournamentCreationStateStore();

const tournamentCreationKeyboards = new TournamentCreationKeyboards();

const tournamentCreationRenderer = new TournamentCreationRenderer(
  tournamentCreationKeyboards,
  DateTimeHelperInstance,
);

const tournamentCreationFlow = new TournamentCreationFlow(
  tournamentCreationStateStore,
  tournamentCreationRenderer,
  DateTimeHelperInstance,
);

export {
  tournamentCreationStateStore,
  tournamentCreationKeyboards,
  tournamentCreationRenderer,
  tournamentCreationFlow,
};
