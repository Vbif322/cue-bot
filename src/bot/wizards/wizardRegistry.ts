export interface IWizardSession {
  /** Человекочитаемое название, e.g. "создание турнира" */
  name: string;
  /** Проверяет, находится ли пользователь в этом wizard */
  isActive(userId: number): boolean;
  /** Единый префикс callback data этого wizard, e.g. "tc:" */
  callbackPrefix: string;
}

const wizardRegistry: IWizardSession[] = [];

export function registerWizard(wizard: IWizardSession): void {
  wizardRegistry.push(wizard);
}

export function getActiveWizard(userId: number): IWizardSession | undefined {
  return wizardRegistry.find((w) => w.isActive(userId));
}
