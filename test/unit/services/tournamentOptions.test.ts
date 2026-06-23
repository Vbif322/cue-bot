import { describe, expect, it } from 'vitest';

import { validateGroupConfig } from '@/shared/tournament/tournamentOptions.js';

describe('validateGroupConfig', () => {
  it('accepts a valid configuration', () => {
    expect(
      validateGroupConfig({
        groupsCount: 4,
        participantsPerGroup: 4,
        qualifiersPerGroup: 2,
      }),
    ).toBeNull();
  });

  it('requires at least 2 groups', () => {
    expect(
      validateGroupConfig({
        groupsCount: 1,
        participantsPerGroup: 4,
        qualifiersPerGroup: 2,
      }),
    ).toMatch(/групп/i);
  });

  it('requires at least 2 participants per group', () => {
    expect(
      validateGroupConfig({
        groupsCount: 2,
        participantsPerGroup: 1,
        qualifiersPerGroup: 1,
      }),
    ).toMatch(/в группе/i);
  });

  it('rejects qualifiers >= participants per group', () => {
    expect(
      validateGroupConfig({
        groupsCount: 2,
        participantsPerGroup: 4,
        qualifiersPerGroup: 4,
      }),
    ).toMatch(/меньше/i);
  });

  it('requires a non-zero qualifier count', () => {
    expect(
      validateGroupConfig({
        groupsCount: 2,
        participantsPerGroup: 4,
        qualifiersPerGroup: 0,
      }),
    ).toMatch(/хотя бы 1/i);
  });
});
