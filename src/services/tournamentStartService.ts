import type { Api } from 'grammy';
import type { UUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db/db.js';
import { matches } from '@/db/schema.js';
import type { TournamentParticipant } from '@/bot/@types/tournament.js';
import {
  fillMissingSeeds,
  getConfirmedParticipantsBySeed,
  startTournament,
  getTournament,
} from './tournamentService.js';
import {
  generateBracket,
  generatePlayoffFromQualifiers,
} from './bracketGenerator.js';
import {
  createMatches,
  getRoundMatches,
  getMatch,
  assignTableAndStart,
  getNextReadyMatch,
} from './matchService.js';
import { getGroupStandings } from './groupPhaseService.js';
import { selectQualifiers } from './standingsService.js';
import { notifyMatchAssigned } from './notificationService.js';
import { getTournamentTables } from './tableService.js';

export interface StartTournamentFullResult {
  participantsCount: number;
  matchesCreated: number;
  tournamentName: string;
}

/**
 * Assign tables to the first N ready matches (auto-start with notification) and
 * notify the remaining participants of `notifyRound` who weren't auto-started.
 *
 * Shared by the initial tournament start and the groups_playoff playoff kickoff.
 * `phase` scopes the notify pass so the playoff kickoff doesn't re-notify the
 * (already completed) group round-1 matches that also live at round 1.
 */
async function kickoffReadyMatches(
  tournamentId: UUID,
  tournament: { name: string; scheduleMode: string },
  notifyRound: number,
  botApi: Api,
  phase?: 'group' | 'playoff',
): Promise<void> {
  const autoStartedMatchIds = new Set<string>();

  // Skipped for per-match scheduling: there the organiser assigns each match's
  // date/time (and table) manually, so matches must not be auto-started here.
  if (tournament.scheduleMode !== 'per_match') {
    const tournamentTables = await getTournamentTables(tournamentId);
    for (const table of tournamentTables) {
      const next = await getNextReadyMatch(tournamentId);
      if (!next) break;
      const ok = await assignTableAndStart(next.id, table.id, botApi);
      if (ok) autoStartedMatchIds.add(next.id);
    }
  }

  const roundMatches = await getRoundMatches(tournamentId, notifyRound);
  for (const match of roundMatches) {
    if (phase && match.phase !== phase) continue;
    if (autoStartedMatchIds.has(match.id)) continue;
    if (match.status === 'completed') continue;
    try {
      const matchWithPlayers = await getMatch(match.id);
      if (matchWithPlayers) {
        await notifyMatchAssigned(botApi, matchWithPlayers, tournament.name);
      }
    } catch (error) {
      console.error(
        `Failed to notify participants for match ${match.id}:`,
        error,
      );
    }
  }
}

/**
 * Full tournament start orchestration:
 * 1. Assign random seeds to participants
 * 2. Generate bracket (group phase only for groups_playoff)
 * 3. Create matches in database
 * 4. Set tournament status to in_progress
 * 5. Assign tables to first N ready matches + notify first-round participants
 */
export async function startTournamentFull(
  tournamentId: UUID,
  botApi: Api,
): Promise<StartTournamentFullResult> {
  const tournament = await getTournament(tournamentId);
  if (!tournament) throw new Error('Турнир не найден');

  // Steps 1–5 run atomically in one transaction, serialized per-tournament by an
  // advisory lock with an in-transaction "matches already exist" guard so two
  // concurrent starts (bot + admin, or a retry) can't double-create matches or
  // leave the tournament with matches but the wrong status. Same pattern as
  // maybeStartPlayoffPhase below.
  const { participantsCount, matchesCreated } = await db.transaction(
    async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${tournamentId}))`,
      );
      const already = await tx.query.matches.findFirst({
        where: eq(matches.tournamentId, tournamentId),
      });
      if (already) throw new Error('Турнир уже запущен');

      // 1. Fill in missing seeds (preserves manual ones)
      await fillMissingSeeds(tournamentId, tx);

      // 2. Get participants ordered by seed
      const participants = await getConfirmedParticipantsBySeed(
        tournamentId,
        tx,
      );
      if (participants.some((p) => p.seed == null)) {
        throw new Error('Не удалось проставить сиды всем участникам');
      }

      // 3. Generate bracket — pure, no I/O. For groups_playoff this is the GROUP
      // phase only; the playoff is generated later by maybeStartPlayoffPhase once
      // standings are known.
      const bracket = generateBracket(
        tournament.format,
        participants,
        tournament.randomAdvancement,
        tournament.mergeRound,
        tournament.format === 'groups_playoff' &&
          tournament.groupsCount != null &&
          tournament.participantsPerGroup != null &&
          tournament.groupDraw != null
          ? {
              groupsCount: tournament.groupsCount,
              participantsPerGroup: tournament.participantsPerGroup,
              groupDraw: tournament.groupDraw,
            }
          : undefined,
      );

      // 4. Create matches in database
      await createMatches(tournamentId, bracket, tx);

      // 5. Update tournament status to in_progress
      await startTournament(tournamentId, tx);

      return {
        participantsCount: participants.length,
        matchesCreated: bracket.length,
      };
    },
  );

  // 6. Assign tables + notify first round (group round 1 for groups_playoff).
  // Kept OUTSIDE the transaction: these are external Telegram/table calls that
  // must not hold or roll back the DB transaction.
  await kickoffReadyMatches(
    tournamentId,
    tournament,
    1,
    botApi,
    tournament.format === 'groups_playoff' ? 'group' : undefined,
  );

  return {
    participantsCount,
    matchesCreated,
    tournamentName: tournament.name,
  };
}

/**
 * Transition a groups_playoff tournament from the group phase to the playoff:
 * compute standings, pick + cross-seed the qualifiers, generate the single-
 * elimination playoff, and kick off its first round.
 *
 * Idempotent: serialized on a per-tournament advisory lock with an in-transaction
 * re-check so two near-simultaneous final-group confirmations can't both generate
 * a bracket. Returns true only if THIS call created the playoff. `botApi` is
 * optional so the transition (match creation) also works headless in tests; the
 * table-assignment/notify kickoff only runs when a bot api is supplied.
 */
export async function maybeStartPlayoffPhase(
  tournamentId: UUID,
  botApi?: Api,
): Promise<boolean> {
  const tournament = await getTournament(tournamentId);
  if (tournament?.format !== 'groups_playoff') return false;
  if (tournament.qualifiersPerGroup == null) return false;

  // Fast path: playoff already generated.
  const existing = await db.query.matches.findFirst({
    where: and(
      eq(matches.tournamentId, tournamentId),
      eq(matches.phase, 'playoff'),
    ),
  });
  if (existing) return false;

  const standings = await getGroupStandings(tournamentId);
  if (standings.length === 0) return false;

  const qualifierIds = selectQualifiers(
    standings,
    tournament.qualifiersPerGroup,
  );
  const participants = await getConfirmedParticipantsBySeed(tournamentId);
  const byId = new Map(participants.map((p) => [p.userId, p]));
  const qualifiers = qualifierIds
    .map((id) => byId.get(id))
    .filter((p): p is TournamentParticipant => p != null);
  if (qualifiers.length < 2) return false;

  const bracket = generatePlayoffFromQualifiers(qualifiers);

  const created = await db.transaction(async (tx) => {
    // Serialize concurrent transitions for this tournament; the lock auto-releases
    // at transaction end.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${tournamentId}))`);
    const already = await tx.query.matches.findFirst({
      where: and(
        eq(matches.tournamentId, tournamentId),
        eq(matches.phase, 'playoff'),
      ),
    });
    if (already) return false;
    await createMatches(tournamentId, bracket, tx);
    return true;
  });
  if (!created) return false;

  // Kick off the first playoff round after commit (skipped headless / no bot).
  if (botApi) {
    await kickoffReadyMatches(tournamentId, tournament, 1, botApi, 'playoff');
  }
  return true;
}
