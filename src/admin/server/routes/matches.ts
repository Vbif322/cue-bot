import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  getMatch,
  getTournamentMatches,
  getMatchStats,
  startMatch,
  reportResult,
  confirmResult,
  disputeResult,
  setTechnicalResult,
} from "../../../services/matchService.js";
import { requireAdmin } from "../middleware.js";
import type { Api } from "grammy";

export function createMatchesRouter(_botApi: Api) {
  const router = new Hono();

  router.use("/*", requireAdmin);

  // List all matches for a tournament
  router.get("/tournament/:tournamentId", async (c) => {
    const matches = await getTournamentMatches(c.req.param("tournamentId"));
    return c.json({ data: matches });
  });

  // Get match stats for a tournament
  router.get("/tournament/:tournamentId/stats", async (c) => {
    const stats = await getMatchStats(c.req.param("tournamentId"));
    return c.json({ data: stats });
  });

  // Get single match with player info
  router.get("/:id", async (c) => {
    const match = await getMatch(c.req.param("id"));
    if (!match) return c.json({ error: "Матч не найден" }, 404);
    return c.json({ data: match });
  });

  // Start a match
  router.post("/:id/start", async (c) => {
    const result = await startMatch(c.req.param("id"));
    if (!result.success) return c.json({ error: result.error }, 400);
    return c.json({ data: result.match });
  });

  // Report result (admin acts as one of the players)
  router.post(
    "/:id/report",
    zValidator(
      "json",
      z.object({
        reporterId: z.string().uuid(),
        player1Score: z.number().int().min(0),
        player2Score: z.number().int().min(0),
      }),
    ),
    async (c) => {
      const { reporterId, player1Score, player2Score } = c.req.valid("json");
      const result = await reportResult(
        c.req.param("id"),
        reporterId,
        player1Score,
        player2Score,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ ok: true });
    },
  );

  // Confirm result
  router.post(
    "/:id/confirm",
    zValidator("json", z.object({ confirmerId: z.string().uuid() })),
    async (c) => {
      const { confirmerId } = c.req.valid("json");
      const result = await confirmResult(c.req.param("id"), confirmerId);
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ ok: true });
    },
  );

  // Dispute result
  router.post(
    "/:id/dispute",
    zValidator("json", z.object({ userId: z.string().uuid() })),
    async (c) => {
      const { userId } = c.req.valid("json");
      const result = await disputeResult(c.req.param("id"), userId);
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ ok: true });
    },
  );

  // Set technical result
  router.post(
    "/:id/technical",
    zValidator(
      "json",
      z.object({
        winnerId: z.string().uuid(),
        reason: z.string().min(1),
      }),
    ),
    async (c) => {
      const { winnerId, reason } = c.req.valid("json");
      const admin = c.get("adminUser");
      const result = await setTechnicalResult(
        c.req.param("id"),
        winnerId,
        reason,
        admin.id,
      );
      if (!result.success) return c.json({ error: result.error }, 400);
      return c.json({ ok: true });
    },
  );

  return router;
}
