import { registerWizard } from '../wizardRegistry.js';
import { ProfileEditStateStore } from './profileEdit.stateStore.js';

const profileEditStateStore = new ProfileEditStateStore();

registerWizard({
  name: 'редактирование профиля',
  namespace: 'profile-edit',
  callbackPrefix: 'pe:',
});

export { profileEditStateStore };
