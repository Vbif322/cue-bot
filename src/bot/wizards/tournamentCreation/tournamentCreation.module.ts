import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';

import { TournamentCreationStateStore } from './tournamentCreation.stateStore.js';
import { TournamentCreationRenderer } from './tournamentCreation.renderer.js';
import { TournamentCreationFlow } from './tournamentCreation.flow.js';
import { TournamentCreationKeyboards } from './tournamentCreation.keyboards.js';
import { registerWizard } from '../wizardRegistry.js';

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

registerWizard({
  name: 'создание турнира',
  isActive: (userId) => tournamentCreationStateStore.has(userId),
  callbackPrefix: 'tc:',
});

export {
  tournamentCreationStateStore,
  tournamentCreationKeyboards,
  tournamentCreationRenderer,
  tournamentCreationFlow,
};
