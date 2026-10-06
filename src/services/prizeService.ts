import { eq, inArray } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { tournaments, users } from '@/db/schema.js';
import type {
  ApiPrizeReport,
  TournamentReadModel,
} from '@/bot/@types/tournament.js';
import {
  computePrizeDistribution,
  expectedParticipants,
  validateFinanceSettings,
  type IFinanceSettings,
} from '@/shared/tournament/prizes.js';
import { getFinalPlacements, type PlacementGroup } from './placementService.js';
import { getTournament } from './tournamentService.js';

const countPlaced = (placements: PlacementGroup[]) =>
  placements.reduce((sum, g) => sum + g.userIds.length, 0);

/**
 * Set the entry fee and prize split. Unlike updateTournamentDraft this works in
 * any status but `cancelled`: it only feeds the prize calculation, so the
 * organizer may adjust it after registration closes or even after the
 * tournament ends. Fixed prizes are checked against the fund at the turnout the
 * report uses — the players who actually played once the tournament is over.
 * A free tournament drops the split, so it never carries a stale one.
 *
 * @throws {Error} Если турнир не найден или отменён.
 * @throws {Error} Если настройки взноса/призов некорректны.
 */
export async function updateTournamentFinance(
  id: UUID,
  settings: IFinanceSettings,
): Promise<TournamentReadModel> {
  const existing = await getTournament(id);
  if (!existing) throw new Error('Турнир не найден');
  if (existing.status === 'cancelled') {
    throw new Error('Турнир отменён — взнос и призы не редактируются');
  }

  const participantsCount =
    existing.status === 'completed'
      ? countPlaced(await getFinalPlacements(existing))
      : expectedParticipants(existing);
  const error = validateFinanceSettings(settings, participantsCount);
  if (error) throw new Error(error);

  await db
    .update(tournaments)
    .set({
      ...(settings.entryFee === null
        ? {
            entryFee: null,
            organizerFeePercent: 0,
            organizerFeeAmount: 0,
            prizeMode: 'percent' as const,
            prizeDistribution: null,
          }
        : settings),
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, id));

  const tournament = await getTournament(id);
  if (!tournament) throw new Error('Ошибка загрузки турнира после обновления');
  return tournament;
}

/**
 * Prize table of a tournament, or null for a free one (no entry fee).
 *
 * A completed tournament gets the final split: every player with their place
 * and amount, the fund based on the players who actually played. Before that it
 * is a forecast by place at the expected turnout (see expectedParticipants).
 *
 * @throws {Error} Если турнир завершён, но места определить не удалось.
 */
export async function getPrizeReport(
  tournament: TournamentReadModel,
): Promise<ApiPrizeReport | null> {
  const {
    entryFee,
    organizerFeePercent,
    organizerFeeAmount,
    prizeMode,
    prizeDistribution,
  } = tournament;
  if (entryFee === null || prizeDistribution === null) return null;

  const settings = {
    entryFee,
    organizerFeePercent,
    organizerFeeAmount,
    prizeMode,
    prizeDistribution,
  };

  if (tournament.status !== 'completed') {
    const report = computePrizeDistribution<UUID>({
      ...settings,
      participantsCount: expectedParticipants(tournament),
    });
    return {
      isFinal: false,
      summary: report.summary,
      rows: report.rows.map((r) => ({ ...r, username: null, name: null })),
    };
  }

  const placements = await getFinalPlacements(tournament);
  const report = computePrizeDistribution(
    { ...settings, participantsCount: countPlaced(placements) },
    placements,
  );

  const ids = report.rows.flatMap((r) => (r.userId ? [r.userId] : []));
  const nameById = new Map<
    UUID,
    { username: string | null; name: string | null }
  >();
  if (ids.length > 0) {
    const rows = await db.query.users.findMany({
      where: inArray(users.id, ids),
      columns: { id: true, username: true, name: true },
    });
    for (const u of rows)
      nameById.set(u.id, { username: u.username, name: u.name });
  }

  return {
    isFinal: true,
    summary: report.summary,
    rows: report.rows.map((r) => ({
      ...r,
      username: r.userId ? (nameById.get(r.userId)?.username ?? null) : null,
      name: r.userId ? (nameById.get(r.userId)?.name ?? null) : null,
    })),
  };
}
