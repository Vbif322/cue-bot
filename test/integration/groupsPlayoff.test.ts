import type { UUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { generateBracket } from '@/services/bracketGenerator.js';
import {
  createMatches,
  getTournamentMatches,
  checkTournamentCompletion,
  correctMatchResult,
  previewCorrection,
} from '@/services/matchService.js';
import {
  getConfirmedParticipantsBySeed,
  getTournament,
  startTournament,
  canStartTournament,
} from '@/services/tournamentService.js';
import { getGroupStandings } from '@/services/groupPhaseService.js';

import {
  completeMatch,
  createTournament,
  createConfirmedParticipant,
} from '../helpers/factories.js';
import { must } from '../helpers/must.js';
import { truncateAll } from '../helpers/truncate.js';

const GROUP_CONFIG = {
  groupsCount: 2,
  participantsPerGroup: 4,
  qualifiersPerGroup: 2,
  groupDraw: 'snake' as const,
};

/** Create a groups_playoff tournament with `count` seeded confirmed participants. */
async function makeGroupsTournament(count: number, status = 'registration_open') {
  const tournament = await createTournament({
    format: 'groups_playoff',
    status: status as 'registration_open',
    ...GROUP_CONFIG,
  });
  for (let seed = 1; seed <= count; seed++) {
    await createConfirmedParticipant(tournament.id, { seed });
  }
  return tournament;
}

/** Generate + persist the group phase headlessly and flip to in_progress. */
async function startGroupPhase(tournamentId: UUID) {
  const participants = await getConfirmedParticipantsBySeed(tournamentId);
  const bracket = generateBracket('groups_playoff', participants, false, 2, {
    groupsCount: GROUP_CONFIG.groupsCount,
    participantsPerGroup: GROUP_CONFIG.participantsPerGroup,
    groupDraw: GROUP_CONFIG.groupDraw,
  });
  await createMatches(tournamentId, bracket);
  await startTournament(tournamentId);
}

/** Complete every still-open match of the given phase (player1 wins each). */
async function completePhase(tournamentId: UUID, phase: 'group' | 'playoff') {
  for (let i = 0; i < 200; i++) {
    const all = await getTournamentMatches(tournamentId);
    const ready = all.find(
      (m) =>
        m.phase === phase &&
        m.player1Id !== null &&
        m.player2Id !== null &&
        (m.status === 'scheduled' || m.status === 'in_progress'),
    );
    if (!ready) break;
    await completeMatch(ready.id, must(ready.player1Id, 'player1Id'));
  }
}

describe('groups_playoff lifecycle', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('generates the playoff only after the group phase finishes, then completes', async () => {
    const t = await makeGroupsTournament(8);
    await startGroupPhase(t.id);

    // Group phase only: 2 groups × C(4,2) = 12 matches, no playoff yet.
    let all = await getTournamentMatches(t.id);
    expect(all).toHaveLength(12);
    expect(all.every((m) => m.phase === 'group')).toBe(true);
    expect(all.filter((m) => m.groupIndex === 0)).toHaveLength(6);
    expect(all.filter((m) => m.groupIndex === 1)).toHaveLength(6);
    expect(await checkTournamentCompletion(t.id)).toBe(false);

    // Play out the groups → triggers the transition on the last confirmation.
    await completePhase(t.id, 'group');

    // Standings are computed per group with full, ranked rows.
    const standings = await getGroupStandings(t.id);
    expect(standings).toHaveLength(2);
    for (const g of standings) {
      expect(g.rows).toHaveLength(4);
      expect(g.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    }

    all = await getTournamentMatches(t.id);
    const playoff = all.filter((m) => m.phase === 'playoff');
    // 2 groups × 2 qualifiers = 4 → single-elim of 4 = 3 matches.
    expect(playoff).toHaveLength(3);
    expect((await getTournament(t.id))?.status).toBe('in_progress');
    // Not complete yet: the playoff final has not been played.
    expect(await checkTournamentCompletion(t.id)).toBe(false);

    // Play out the playoff → tournament completes.
    await completePhase(t.id, 'playoff');
    expect((await getTournament(t.id))?.status).toBe('completed');
    expect(await checkTournamentCompletion(t.id)).toBe(true);
  });

  it('is idempotent: re-running the transition does not duplicate the playoff', async () => {
    const t = await makeGroupsTournament(8);
    await startGroupPhase(t.id);
    await completePhase(t.id, 'group');

    const before = (await getTournamentMatches(t.id)).filter(
      (m) => m.phase === 'playoff',
    ).length;

    const { maybeStartPlayoffPhase } = await import(
      '@/services/tournamentStartService.js'
    );
    const created = await maybeStartPlayoffPhase(t.id);
    expect(created).toBe(false);

    const after = (await getTournamentMatches(t.id)).filter(
      (m) => m.phase === 'playoff',
    ).length;
    expect(after).toBe(before);
  });

  it('locks group results once the playoff has started', async () => {
    const t = await makeGroupsTournament(8);
    await startGroupPhase(t.id);

    // A completed group match is correctable before the playoff exists.
    const groupMatch = (await getTournamentMatches(t.id)).find(
      (m) => m.phase === 'group',
    );
    if (!groupMatch) throw new Error('no group match');
    await completeMatch(groupMatch.id, must(groupMatch.player1Id, 'player1Id'));
    const preBefore = await previewCorrection(groupMatch.id, 0, 3);
    expect(preBefore.valid).toBe(true);

    // Finish the groups → playoff generated → group results lock.
    await completePhase(t.id, 'group');

    const preAfter = await previewCorrection(groupMatch.id, 0, 3);
    expect(preAfter.valid).toBe(false);

    const corrected = await correctMatchResult(
      groupMatch.id,
      0,
      3,
      'test',
      must(groupMatch.player1Id, 'player1Id'),
    );
    expect(corrected.success).toBe(false);
  });

  it('allows under-filled groups (walkover padding) within bounds', async () => {
    // 2 groups × 4, 2 qualify. 8 = full, 6 = under-filled (ok, walkovers),
    // 9 = too many, 2 = too few (smallest group < qualifiers).
    const full = await makeGroupsTournament(8, 'registration_closed');
    expect((await canStartTournament(full.id)).canStart).toBe(true);

    const under = await makeGroupsTournament(6, 'registration_closed');
    expect((await canStartTournament(under.id)).canStart).toBe(true);

    const tooMany = await makeGroupsTournament(9, 'registration_closed');
    expect((await canStartTournament(tooMany.id)).canStart).toBe(false);

    const tooFew = await makeGroupsTournament(2, 'registration_closed');
    expect((await canStartTournament(tooFew.id)).canStart).toBe(false);
  });

  it('runs an under-filled tournament: walkover matches auto-complete', async () => {
    // 2 groups × 4 with 6 players → snake 3 + 3, each group gets 1 walkover slot.
    const t = await makeGroupsTournament(6);
    await startGroupPhase(t.id);

    const all = await getTournamentMatches(t.id);
    // 2 groups × C(4,2) = 12 rows; the two walkover slots each auto-win vs 3 reals.
    expect(all).toHaveLength(12);
    const walkovers = all.filter((m) => m.status === 'completed');
    expect(walkovers.length).toBe(6); // 3 per group, pre-completed at creation

    // Standings still rank only the real players.
    const standings = await getGroupStandings(t.id);
    expect(standings).toHaveLength(2);
    for (const g of standings) {
      expect(g.rows).toHaveLength(3);
    }

    // Play the remaining real matches → playoff generates → tournament completes.
    await completePhase(t.id, 'group');
    expect(
      (await getTournamentMatches(t.id)).some((m) => m.phase === 'playoff'),
    ).toBe(true);
    await completePhase(t.id, 'playoff');
    expect((await getTournament(t.id))?.status).toBe('completed');
  });
});
