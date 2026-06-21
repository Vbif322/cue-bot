import { describe, expect, it } from 'vitest';

import { mergeCreationData } from '@/bot/wizards/tournamentCreation/tournamentCreation.stateStore.js';
import type { ICreationData } from '@/bot/wizards/tournamentCreation/tournamentCreation.js';

// uuid-shaped ids: venue/table id columns are typed `crypto.UUID`.
const TABLE_1 = '00000000-0000-0000-0000-000000000001';
const TABLE_2 = '00000000-0000-0000-0000-000000000002';
const VENUE_1 = '00000000-0000-0000-0000-00000000000a';

describe('mergeCreationData', () => {
  it('deep-merges tournament fields across successive patches', () => {
    const a = mergeCreationData({ tables: [] }, { tournament: { name: 'Cup' } });
    const b = mergeCreationData(a, { tournament: { winScore: 3 } });

    expect(b.tournament).toMatchObject({ name: 'Cup', winScore: 3 });
  });

  it('keeps a previously set venue when the patch omits it', () => {
    const prev: ICreationData = { venue: { id: VENUE_1, name: 'Hall' }, tables: [] };
    const merged = mergeCreationData(prev, { tournament: { name: 'Cup' } });

    expect(merged.venue).toEqual({ id: VENUE_1, name: 'Hall' });
  });

  it('replaces tables when provided', () => {
    const prev: ICreationData = {
      tables: [{ id: TABLE_1, name: 'Table 1' }],
    };
    const merged = mergeCreationData(prev, {
      tables: [{ id: TABLE_2, name: 'Table 2' }],
    });

    expect(merged.tables).toEqual([{ id: TABLE_2, name: 'Table 2' }]);
  });

  it('keeps existing tables (defaulting to []) when the patch omits them', () => {
    const withTables: ICreationData = {
      tables: [{ id: TABLE_1, name: 'Table 1' }],
    };
    expect(
      mergeCreationData(withTables, { tournament: { name: 'Cup' } }).tables,
    ).toEqual([{ id: TABLE_1, name: 'Table 1' }]);

    const empty: ICreationData = {};
    expect(
      mergeCreationData(empty, { tournament: { name: 'Cup' } }).tables,
    ).toEqual([]);
  });
});
