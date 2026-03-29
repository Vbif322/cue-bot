import type { venues } from '../../db/schema.ts';
import type { Serialize } from './helpers.ts';

export type Venue = typeof venues.$inferSelect;
export type ApiVenue = Serialize<Venue> & { tablesCount: number };
