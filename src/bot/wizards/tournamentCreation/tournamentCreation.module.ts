import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';

import { TournamentCreationStateStore } from './tournamentCreation.stateStore.js';
import { TournamentCreationRenderer } from './tournamentCreation.renderer.js';
import { TournamentCreationFlow } from './tournamentCreation.flow.js';
import { TournamentCreationKeyboards } from './tournamentCreation.keyboards.js';
import { registerTextSession } from '../../sessions/textSessionRegistry.js';

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

registerTextSession({
  store: tournamentCreationStateStore.session,
  name: 'создание турнира',
  blocking: true,
  callbackPrefix: 'tc:',
  cancelReply: 'Создание турнира отменено.',
  onText: (ctx, state) =>
    tournamentCreationFlow.handleTextInput(ctx, state, ctx.message.text),
});

export {
  tournamentCreationStateStore,
  tournamentCreationKeyboards,
  tournamentCreationRenderer,
  tournamentCreationFlow,
};
