import { and, eq, gt, inArray } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { dialogSessions } from '@/db/schema.js';

export interface IWizardSession {
  /** Человекочитаемое название, e.g. "создание турнира" */
  name: string;
  /** Namespace состояния этого wizard в таблице `dialog_sessions`, e.g. "tc" */
  namespace: string;
  /** Единый префикс callback data этого wizard, e.g. "tc:" */
  callbackPrefix: string;
}

const wizardRegistry: IWizardSession[] = [];

export function registerWizard(wizard: IWizardSession): void {
  wizardRegistry.push(wizard);
}

/**
 * Возвращает активный для пользователя wizard (если есть) — ОДНИМ запросом.
 *
 * «Активность» определяется наличием непросроченной строки в `dialog_sessions`
 * с key=userId и namespace одного из зарегистрированных wizard'ов.
 *
 * @param {number} userId Telegram id пользователя
 *
 * @returns {Promise<IWizardSession | undefined>} активный wizard или undefined
 */
export async function getActiveWizard(
  userId: number,
): Promise<IWizardSession | undefined> {
  const namespaces = wizardRegistry.map((w) => w.namespace);
  if (namespaces.length === 0) return undefined;

  const row = await db.query.dialogSessions.findFirst({
    columns: { namespace: true },
    where: and(
      eq(dialogSessions.key, String(userId)),
      inArray(dialogSessions.namespace, namespaces),
      gt(dialogSessions.expiresAt, new Date()),
    ),
  });

  if (!row) return undefined;

  return wizardRegistry.find((w) => w.namespace === row.namespace);
}
