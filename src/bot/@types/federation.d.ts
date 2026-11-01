import type { UUID } from 'crypto';

import type { federations, federationMembers } from '../../db/schema.ts';
import type { Serialize } from './helpers.ts';

export type Federation = typeof federations.$inferSelect;
export type FederationRole = (typeof federationMembers.$inferSelect)['role'];

/** Federation row as returned by the admin API. */
export type ApiFederation = Serialize<Federation>;

/** Admin list row: a federation with team/tournament counts. */
export type ApiFederationSummary = ApiFederation & {
  membersCount: number;
  tournamentsCount: number;
  /** Latest owner `organizerUntil` (ISO): new tournaments allowed until then; null — closed. */
  activeUntil: string | null;
};

/** A federation as seen by one of its members (the switcher in the panel). */
export interface ApiUserFederation {
  id: UUID;
  name: string;
  city: string;
  role: FederationRole;
  /** Latest owner `organizerUntil` (ISO): new tournaments allowed until then; null — closed. */
  activeUntil: string | null;
}

/** Federation detail for its member: the row plus the viewer's role (null for admin). */
export type ApiFederationDetail = ApiFederation & {
  role: FederationRole | null;
};

export interface ApiFederationMember {
  userId: UUID;
  role: FederationRole;
  username: string;
  name: string | null;
  surname: string | null;
  telegramLinked: boolean;
  createdAt: string;
}

/** Group chat as managed on the federation page (chats the federation may bind). */
export interface ApiFederationChat {
  chatId: string;
  title: string | null;
  type: 'group' | 'supergroup';
  isActive: boolean;
  /** Bound to this federation (`true`) or still unbound (hears every public tournament). */
  bound: boolean;
}

/** Public organizer card (player feed filter). */
export interface ApiPublicFederation {
  id: UUID;
  name: string;
  city: string;
  description: string | null;
}
