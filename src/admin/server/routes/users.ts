import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../../../db/db.js";
import {
  users,
  tournamentReferees,
} from "../../../db/schema.js";
import { requireAdmin } from "../middleware.js";

export function createUsersRouter() {
  const router = new Hono();

  router.use("/*", requireAdmin);

  // List all users
  router.get("/", async (c) => {
    const allUsers = await db.query.users.findMany({
      orderBy: (u, { asc }) => [asc(u.username)],
    });
    return c.json({ data: allUsers });
  });

  // Get single user
  router.get("/:id", async (c) => {
    const user = await db.query.users.findFirst({
      where: eq(users.id, c.req.param("id")),
    });
    if (!user) return c.json({ error: "Не найден" }, 404);
    return c.json({ data: user });
  });

  // Update user role
  router.patch(
    "/:id/role",
    zValidator("json", z.object({ role: z.enum(["user", "admin"]) })),
    async (c) => {
      const admin = c.get("adminUser");
      const targetId = c.req.param("id");

      if (admin.id === targetId) {
        return c.json({ error: "Нельзя изменить собственную роль" }, 400);
      }

      await db
        .update(users)
        .set({ role: c.req.valid("json").role })
        .where(eq(users.id, targetId));

      const updated = await db.query.users.findFirst({
        where: eq(users.id, targetId),
      });

      return c.json({ data: updated });
    },
  );

  // Assign referee to tournament
  router.post(
    "/:id/referee",
    zValidator("json", z.object({ tournamentId: z.string().uuid() })),
    async (c) => {
      const userId = c.req.param("id");
      const { tournamentId } = c.req.valid("json");

      await db
        .insert(tournamentReferees)
        .values({ userId, tournamentId })
        .onConflictDoNothing();

      return c.json({ ok: true });
    },
  );

  // Remove referee from tournament
  router.delete("/:id/referee/:tournamentId", async (c) => {
    const userId = c.req.param("id");
    const tournamentId = c.req.param("tournamentId");

    await db
      .delete(tournamentReferees)
      .where(
        and(
          eq(tournamentReferees.userId, userId),
          eq(tournamentReferees.tournamentId, tournamentId),
        ),
      );

    return c.json({ ok: true });
  });

  return router;
}
