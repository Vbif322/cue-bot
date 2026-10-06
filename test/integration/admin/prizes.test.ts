import { beforeEach, describe, expect, it } from 'vitest';

import { createAdminServer } from '@/admin/server/index.js';
import type { ApiPrizeReport } from '@/bot/@types/tournament.js';

import { apiRequest } from '../../helpers/auth.js';
import {
  createAdminUser,
  createMatchesForTournament,
  createTournament,
  createTournamentWithParticipants,
  playAllReady,
} from '../../helpers/factories.js';
import { truncateAll } from '../../helpers/truncate.js';

const app = createAdminServer();

const places = (...values: number[]) =>
  values.map((value, i) => ({ place: i + 1, value }));

const finance = {
  entryFee: 1000,
  organizerFeePercent: 10,
  organizerFeeAmount: 0,
  prizeMode: 'percent' as const,
  prizeDistribution: places(50, 30, 20),
};

// 8 players × 1000 − an 800 ₽ cut = a 7200 fund.
const fixedFinance = {
  ...finance,
  organizerFeeAmount: 800,
  prizeMode: 'fixed' as const,
  prizeDistribution: places(4000, 2000, 1000),
};

describe('admin tournament finance + prizes', () => {
  let admin: Awaited<ReturnType<typeof createAdminUser>>;

  beforeEach(async () => {
    await truncateAll();
    admin = await createAdminUser();
  });

  it('PATCH /:id/finance stores the settings; a free tournament drops the split', async () => {
    const t = await createTournament();

    const set = await apiRequest<{ data: typeof finance }>(
      app,
      'PATCH',
      `/api/tournaments/${t.id}/finance`,
      { user: admin, body: finance },
    );
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject(finance);

    const cleared = await apiRequest<{ data: typeof finance }>(
      app,
      'PATCH',
      `/api/tournaments/${t.id}/finance`,
      {
        user: admin,
        body: { ...finance, entryFee: null },
      },
    );
    expect(cleared.body.data).toMatchObject({
      entryFee: null,
      organizerFeePercent: 0,
      organizerFeeAmount: 0,
      prizeDistribution: null,
    });
  });

  it('PATCH /:id/finance rejects a split that does not sum to 100', async () => {
    const t = await createTournament();
    const { status } = await apiRequest(
      app,
      'PATCH',
      `/api/tournaments/${t.id}/finance`,
      {
        user: admin,
        body: {
          ...finance,
          prizeDistribution: places(90),
        },
      },
    );
    expect(status).toBe(400);
  });

  it('PATCH /:id/finance: fixed prizes must fit the fund at the expected turnout', async () => {
    const { tournament } = await createTournamentWithParticipants(
      8,
      'single_elimination',
    );
    const path = `/api/tournaments/${tournament.id}/finance`;

    const ok = await apiRequest(app, 'PATCH', path, {
      user: admin,
      body: fixedFinance,
    });
    expect(ok.status).toBe(200);

    const tooMuch = await apiRequest<{ error: string }>(app, 'PATCH', path, {
      user: admin,
      body: { ...fixedFinance, prizeDistribution: places(5000, 3000) },
    });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatch(/больше собранных взносов/);
  });

  it('PATCH /:id/finance works after the start but not on a cancelled tournament', async () => {
    const running = await createTournament({ status: 'in_progress' });
    const ok = await apiRequest(
      app,
      'PATCH',
      `/api/tournaments/${running.id}/finance`,
      { user: admin, body: finance },
    );
    expect(ok.status).toBe(200);

    const cancelled = await createTournament({ status: 'cancelled' });
    const refused = await apiRequest<{ error: string }>(
      app,
      'PATCH',
      `/api/tournaments/${cancelled.id}/finance`,
      { user: admin, body: finance },
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/отменён/);
  });

  it('GET /:id/prizes: null for a free tournament', async () => {
    const t = await createTournament();
    const { status, body } = await apiRequest<{ data: unknown }>(
      app,
      'GET',
      `/api/tournaments/${t.id}/prizes`,
      { user: admin },
    );
    expect(status).toBe(200);
    expect(body.data).toBeNull();
  });

  it('GET /:id/prizes: forecast by place before the end', async () => {
    const { tournament } = await createTournamentWithParticipants(
      8,
      'single_elimination',
      finance,
    );
    const { body } = await apiRequest<{ data: ApiPrizeReport }>(
      app,
      'GET',
      `/api/tournaments/${tournament.id}/prizes`,
      { user: admin },
    );

    expect(body.data.isFinal).toBe(false);
    expect(body.data.summary).toMatchObject({
      participantsCount: 8,
      collected: 8000,
      organizerShare: 800,
      prizeFund: 7200,
    });
    expect(
      body.data.rows.map((r) => [r.placeFrom, r.userId, r.amount]),
    ).toEqual([
      [1, null, 3600],
      [2, null, 2160],
      [3, null, 1440],
    ]);
  });

  it('GET /:id/prizes: final split by player once completed', async () => {
    const { tournament, participantIds } =
      await createTournamentWithParticipants(8, 'single_elimination', finance);
    await createMatchesForTournament(tournament.id, 'single_elimination');
    await playAllReady(tournament.id, 'single_elimination');

    const { body } = await apiRequest<{ data: ApiPrizeReport }>(
      app,
      'GET',
      `/api/tournaments/${tournament.id}/prizes`,
      { user: admin },
    );
    const { isFinal, summary, rows } = body.data;

    expect(isFinal).toBe(true);
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.userId).sort()).toEqual(
      [...participantIds].sort(),
    );
    expect(rows.every((r) => r.name !== null || r.username !== null)).toBe(
      true,
    );
    // 1st 3600, 2nd 2160, 3rd place's 1440 shared by both semifinal losers.
    expect(rows.map((r) => r.amount)).toEqual([
      3600, 2160, 720, 720, 0, 0, 0, 0,
    ]);
    expect(summary.paidOut).toBe(7200);
    expect(summary.remainder).toBe(0);
  });

  it('GET /:id/prizes: fixed amounts, shared places split them', async () => {
    const { tournament } = await createTournamentWithParticipants(
      8,
      'single_elimination',
      fixedFinance,
    );
    await createMatchesForTournament(tournament.id, 'single_elimination');
    await playAllReady(tournament.id, 'single_elimination');

    const { body } = await apiRequest<{ data: ApiPrizeReport }>(
      app,
      'GET',
      `/api/tournaments/${tournament.id}/prizes`,
      { user: admin },
    );

    expect(body.data.summary).toMatchObject({
      prizeMode: 'fixed',
      organizerShare: 800,
      prizeFund: 7200,
      paidOut: 7000,
      remainder: 200,
    });
    expect(body.data.rows.map((r) => r.amount)).toEqual([
      4000, 2000, 500, 500, 0, 0, 0, 0,
    ]);
  });
});
