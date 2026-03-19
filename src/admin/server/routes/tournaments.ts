import { randomUUID } from "crypto";
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
import {
  getTournamentTables,
  setTournamentTables,
} from "../../../services/tableService.js";
import { requireAdmin } from "../middleware.js";
import type { Api } from "grammy";

export function createTournamentsRouter(botApi: Api) {
  const router = new Hono();

  router.use("/*", requireAdmin);

  router.get("/", async (c) => {
    const list = await getTournaments({ limit: 100, includesDrafts: true });
    return c.json({ data: list });
  });

  router.get("/:id", async (c) => {
    const tournament = await getTournament(c.req.param("id"));
    if (!tournament) return c.json({ error: "Не найден" }, 404);
    return c.json({ data: tournament });
  });

  router.get("/:id/tables", async (c) => {
    const list = await getTournamentTables(c.req.param("id"));
    return c.json({ data: list });
  });

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
        tableIds: z.array(z.string().uuid()).optional(),
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

      if (!tournament) return c.json({ error: "Ошибка создания турнира" }, 500);

      const allTableIds = body.tableIds ?? [];

      if (allTableIds.length > 0) {
        await setTournamentTables(tournament.id, allTableIds);
      }

      return c.json({ data: tournament }, 201);
    },
  );

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

  router.get("/:id/participants", async (c) => {
    const id = c.req.param("id");

    const dbParticipants = await db
      .select({
        userId: tournamentParticipants.userId,
        status: tournamentParticipants.status,
        seed: tournamentParticipants.seed,
        username: users.username,
        name: users.name,
        isGuest: users.isGuest,
      })
      .from(tournamentParticipants)
      .innerJoin(users, eq(tournamentParticipants.userId, users.id))
      .where(eq(tournamentParticipants.tournamentId, id));

    return c.json({ data: dbParticipants });
  });

  router.get("/:id/stats", async (c) => {
    const stats = await getMatchStats(c.req.param("id"));
    return c.json({ data: stats });
  });

  router.post(
    "/:id/participants",
    zValidator(
      "json",
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("user"), userId: z.string().uuid() }),
        z.object({
          type: z.literal("guest"),
          guestName: z.string().min(1).max(255),
          telegramUsername: z.string().max(255).optional(),
        }),
      ]),
    ),
    async (c) => {
      const tournamentId = c.req.param("id");
      const body = c.req.valid("json");

      let userId: string;

      if (body.type === "guest") {
        const ghostTelegramId = `ghost_${randomUUID()}`;
        const [ghostUser] = await db
          .insert(users)
          .values({
            telegram_id: ghostTelegramId,
            username: body.telegramUsername ?? body.guestName.slice(0, 255),
            name: body.guestName,
            isGuest: true,
          })
          .returning({ id: users.id });

        if (!ghostUser) return c.json({ error: "Ошибка создания участника" }, 500);
        userId = ghostUser.id;
      } else {
        userId = body.userId;
      }

      await db
        .insert(tournamentParticipants)
        .values({ tournamentId, userId, status: "confirmed" })
        .onConflictDoNothing();

      return c.json({ ok: true });
    },
  );

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

    // Clean up ghost user if they have no remaining participations
    const [user] = await db
      .select({ isGuest: users.isGuest })
      .from(users)
      .where(eq(users.id, userId));

    if (user?.isGuest) {
      const remaining = await db
        .select({ userId: tournamentParticipants.userId })
        .from(tournamentParticipants)
        .where(eq(tournamentParticipants.userId, userId));

      if (remaining.length === 0) {
        await db.delete(users).where(eq(users.id, userId));
      }
    }

    return c.json({ ok: true });
  });

  return router;
}
