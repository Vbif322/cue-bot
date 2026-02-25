import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../../../db/db.js";
import { tournaments, tournamentParticipants, users } from "../../../db/schema.js";
import {
  getTournament,
  getTournaments,
  updateTournamentStatus,
  deleteTournament,
  canDeleteTournament,
  closeRegistrationWithCount,
  canStartTournament,
} from "../../../services/tournamentService.js";
import { startTournamentFull } from "../../../services/tournamentStartService.js";
import { getMatchStats } from "../../../services/matchService.js";
import { requireAdmin } from "../middleware.js";
import type { Api } from "grammy";

export function createTournamentsRouter(botApi: Api) {
  const router = new Hono();

  router.use("/*", requireAdmin);

  // List all tournaments
  router.get("/", async (c) => {
    const list = await getTournaments({ limit: 100, includesDrafts: true });
    return c.json({ data: list });
  });

  // Get single tournament
  router.get("/:id", async (c) => {
    const tournament = await getTournament(c.req.param("id"));
    if (!tournament) return c.json({ error: "Не найден" }, 404);
    return c.json({ data: tournament });
  });

  // Create tournament
  router.post(
    "/",
    zValidator(
      "json",
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        rules: z.string().optional(),
        format: z.enum(["single_elimination", "double_elimination", "round_robin"]),
        maxParticipants: z.number().int().min(2).max(64).default(16),
        winScore: z.number().int().min(1).default(3),
        startDate: z.string().optional(),
        createdBy: z.string().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const admin = c.get("adminUser");

      const [tournament] = await db
        .insert(tournaments)
        .values({
          name: body.name,
          description: body.description ?? null,
          rules: body.rules ?? null,
          format: body.format,
          discipline: "snooker",
          maxParticipants: body.maxParticipants,
          winScore: body.winScore,
          startDate: body.startDate ? new Date(body.startDate) : null,
          createdBy: admin.id,
        })
        .returning();

      return c.json({ data: tournament }, 201);
    },
  );

  // Update tournament status
  router.patch(
    "/:id/status",
    zValidator(
      "json",
      z.object({
        status: z.enum([
          "draft",
          "registration_open",
          "registration_closed",
          "in_progress",
          "completed",
          "cancelled",
        ]),
      }),
    ),
    async (c) => {
      const { status } = c.req.valid("json");
      const id = c.req.param("id");

      if (status === "registration_closed") {
        await closeRegistrationWithCount(id);
      } else {
        await updateTournamentStatus(id, status);
      }

      const updated = await getTournament(id);
      return c.json({ data: updated });
    },
  );

  // Start tournament (full orchestration)
  router.post("/:id/start", async (c) => {
    const id = c.req.param("id");

    const canStart = await canStartTournament(id);
    if (!canStart.canStart) {
      return c.json({ error: canStart.error }, 400);
    }

    try {
      const result = await startTournamentFull(id, botApi);
      return c.json({ data: result });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Неизвестная ошибка" },
        500,
      );
    }
  });

  // Delete tournament
  router.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const tournament = await getTournament(id);

    if (!tournament) return c.json({ error: "Не найден" }, 404);

    if (!canDeleteTournament(tournament.status)) {
      return c.json(
        { error: "Можно удалять только черновики и отменённые турниры" },
        400,
      );
    }

    await deleteTournament(id);
    return c.json({ ok: true });
  });

  // Get tournament participants
  router.get("/:id/participants", async (c) => {
    const id = c.req.param("id");

    // Get full status from DB
    const dbParticipants = await db
      .select({
        userId: tournamentParticipants.userId,
        status: tournamentParticipants.status,
        seed: tournamentParticipants.seed,
        username: users.username,
        name: users.name,
      })
      .from(tournamentParticipants)
      .innerJoin(users, eq(tournamentParticipants.userId, users.id))
      .where(eq(tournamentParticipants.tournamentId, id));

    return c.json({ data: dbParticipants });
  });

  // Get tournament match stats
  router.get("/:id/stats", async (c) => {
    const stats = await getMatchStats(c.req.param("id"));
    return c.json({ data: stats });
  });

  // Add participant to tournament
  router.post(
    "/:id/participants",
    zValidator("json", z.object({ userId: z.string().uuid() })),
    async (c) => {
      const tournamentId = c.req.param("id");
      const { userId } = c.req.valid("json");

      await db
        .insert(tournamentParticipants)
        .values({ tournamentId, userId, status: "confirmed" })
        .onConflictDoNothing();

      return c.json({ ok: true });
    },
  );

  // Remove participant from tournament
  router.delete("/:id/participants/:userId", async (c) => {
    const tournamentId = c.req.param("id");
    const userId = c.req.param("userId");

    await db
      .delete(tournamentParticipants)
      .where(
        and(
          eq(tournamentParticipants.tournamentId, tournamentId),
          eq(tournamentParticipants.userId, userId),
        ),
      );

    return c.json({ ok: true });
  });

  return router;
}
