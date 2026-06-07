import { registerWizard } from '../wizardRegistry.js';
import { ProfileEditStateStore } from './profileEdit.stateStore.js';

const profileEditStateStore = new ProfileEditStateStore();

registerWizard({
  name: 'редактирование профиля',
  isActive: (userId) => profileEditStateStore.has(userId),
  callbackPrefix: 'pe:',
});

export { profileEditStateStore };
