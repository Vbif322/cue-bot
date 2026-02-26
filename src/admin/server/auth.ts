import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, lt } from "drizzle-orm";
import { randomInt } from "crypto";
import jwt from "jsonwebtoken";
import { db } from "../../db/db.js";
import { users, loginCodes } from "../../db/schema.js";
import { signToken, JWT_SECRET, type AdminUser } from "./middleware.js";
import type { Api } from "grammy";

const MAX_ATTEMPTS = 5;
const CODE_TTL_MS = 5 * 60 * 1000;

function generateCode(): string {
  return String(randomInt(100000, 1000000));
}

export function createAuthRouter(botApi: Api) {
  const auth = new Hono();

  auth.post(
    "/request-code",
    zValidator("json", z.object({ username: z.string().min(1) })),
    async (c) => {
      const { username } = c.req.valid("json");
      const normalizedUsername = username.replace(/^@/, "");

      const user = await db.query.users.findFirst({
        where: eq(users.username, normalizedUsername),
      });

      if (!user) {
        return c.json(
          {
            error:
              "Пользователь не найден. Убедитесь что вы писали /start боту.",
          },
          404,
        );
      }

      if (user.role !== "admin") {
        return c.json({ error: "Недостаточно прав" }, 403);
      }

      const code = generateCode();
      const expiresAt = new Date(Date.now() + CODE_TTL_MS);

      // Upsert code and reset attempt counter; delete expired codes opportunistically
      await db.delete(loginCodes).where(lt(loginCodes.expiresAt, new Date()));
      await db
        .insert(loginCodes)
        .values({ username: normalizedUsername, code, expiresAt, attempts: 0 })
        .onConflictDoUpdate({
          target: loginCodes.username,
          set: { code, expiresAt, attempts: 0 },
        });

      try {
        await botApi.sendMessage(
          user.telegram_id,
          `Код для входа в админ-панель: \`\`\`${code}\`\`\`\n\nКод действителен 5 минут.`,
          { parse_mode: "Markdown" },
        );
      } catch {
        await db
          .delete(loginCodes)
          .where(eq(loginCodes.username, normalizedUsername));
        return c.json(
          {
            error:
              "Не удалось отправить код. Сначала напишите /start боту в Telegram.",
          },
          500,
        );
      }

      return c.json({ ok: true });
    },
  );

  auth.post(
    "/verify-code",
    zValidator(
      "json",
      z.object({ username: z.string().min(1), code: z.string().length(6) }),
    ),
    async (c) => {
      const { username, code } = c.req.valid("json");
      const normalizedUsername = username.replace(/^@/, "");

      const pending = await db.query.loginCodes.findFirst({
        where: eq(loginCodes.username, normalizedUsername),
      });

      if (!pending || pending.expiresAt <= new Date()) {
        await db
          .delete(loginCodes)
          .where(eq(loginCodes.username, normalizedUsername));
        return c.json({ error: "Код недействителен или истёк" }, 401);
      }

      if (pending.attempts >= MAX_ATTEMPTS) {
        return c.json(
          { error: "Слишком много попыток. Запросите новый код." },
          429,
        );
      }

      if (pending.code !== code) {
        await db
          .update(loginCodes)
          .set({ attempts: pending.attempts + 1 })
          .where(eq(loginCodes.username, normalizedUsername));
        return c.json({ error: "Неверный код" }, 401);
      }

      await db
        .delete(loginCodes)
        .where(eq(loginCodes.username, normalizedUsername));

      const user = await db.query.users.findFirst({
        where: eq(users.username, normalizedUsername),
      });

      if (!user || user.role !== "admin") {
        return c.json({ error: "Ошибка авторизации" }, 403);
      }

      const token = signToken({
        id: user.id,
        username: user.username,
        role: user.role,
      });

      c.header(
        "Set-Cookie",
        `admin_token=${token}; HttpOnly; Path=/; Max-Age=${24 * 60 * 60}; SameSite=Strict`,
      );

      return c.json({
        user: { id: user.id, username: user.username, role: user.role },
      });
    },
  );

  auth.post("/logout", (c) => {
    c.header(
      "Set-Cookie",
      "admin_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict",
    );
    return c.json({ ok: true });
  });

  auth.get("/me", async (c) => {
    const cookie = c.req.header("Cookie") ?? "";
    const tokenMatch = cookie.match(/admin_token=([^;]+)/);
    const token = tokenMatch?.[1];

    if (!token) return c.json({ user: null });

    try {
      const payload = jwt.verify(token, JWT_SECRET) as AdminUser;

      const user = await db.query.users.findFirst({
        where: eq(users.id, payload.id),
      });

      if (!user || user.role !== "admin") {
        return c.json({ user: null });
      }

      return c.json({
        user: { id: user.id, username: user.username, role: user.role },
      });
    } catch {
      return c.json({ user: null });
    }
  });

  return auth;
}
