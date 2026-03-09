import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  getTables,
  createTable,
  deleteTable,
} from "../../../services/tableService.js";
import { requireAdmin } from "../middleware.js";

export function createTablesRouter() {
  const router = new Hono();

  router.use("/*", requireAdmin);

  router.get("/", async (c) => {
    const list = await getTables();
    return c.json({ data: list });
  });

  router.post(
    "/",
    zValidator("json", z.object({ name: z.string().min(1).max(100) })),
    async (c) => {
      const { name } = c.req.valid("json");
      const table = await createTable(name);
      return c.json({ data: table }, 201);
    },
  );

  router.delete("/:id", async (c) => {
    await deleteTable(c.req.param("id"));
    return c.json({ ok: true });
  });

  return router;
}
