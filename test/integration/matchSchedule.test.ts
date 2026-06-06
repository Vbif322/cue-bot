import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/db.js';
import { matches } from '@/db/schema.js';
import { setMatchSchedule } from '@/services/matchService.js';

import { createTournament } from '../helpers/factories.js';
import { truncateAll } from '../helpers/truncate.js';

describe('setMatchSchedule', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('sets and clears a match scheduledAt', async () => {
    const t = await createTournament({ scheduleMode: 'per_match' });
    const [m] = await db
      .insert(matches)
      .values({ tournamentId: t.id, round: 1, position: 1 })
      .returning();

    const set = await setMatchSchedule(m!.id, new Date('2026-06-21T18:30:00Z'));
    expect(set.success).toBe(true);
    expect(set.match?.scheduledAt).toBeInstanceOf(Date);

    const cleared = await setMatchSchedule(m!.id, null);
    expect(cleared.success).toBe(true);
    expect(cleared.match?.scheduledAt).toBeNull();

    const row = await db.query.matches.findFirst({
      where: eq(matches.id, m!.id),
    });
    expect(row?.scheduledAt).toBeNull();
  });

  it('returns an error for a non-existent match', async () => {
    const result = await setMatchSchedule(
      '00000000-0000-0000-0000-000000000000' as never,
      new Date('2026-06-21T18:30:00Z'),
    );
    expect(result.success).toBe(false);
  });
});
