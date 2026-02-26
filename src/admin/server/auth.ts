import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "../../db/db.js";
import { users } from "../../db/schema.js";
import { signToken, JWT_SECRET } from "./middleware.js";
import type { Api } from "grammy";

// In-memory store for pending login codes (TTL: 5 min)
const pendingCodes = new Map<string, { code: string; expiresAt: number }>();

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
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
      pendingCodes.set(normalizedUsername, {
        code,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      try {
        await botApi.sendMessage(
          user.telegram_id,
          `Код для входа в админ-панель: \`\`\`${code}\`\`\`\n\nКод действителен 5 минут.`,
          { parse_mode: "Markdown" },
        );
      } catch {
        pendingCodes.delete(normalizedUsername);
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

      const pending = pendingCodes.get(normalizedUsername);

      if (!pending || pending.expiresAt < Date.now()) {
        pendingCodes.delete(normalizedUsername);
        return c.json({ error: "Код недействителен или истёк" }, 401);
      }

      if (pending.code !== code) {
        return c.json({ error: "Неверный код" }, 401);
      }

      pendingCodes.delete(normalizedUsername);

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
      const payload = jwt.verify(token, JWT_SECRET) as {
        id: string;
        username: string;
        role: string;
      };
      return c.json({ user: payload });
    } catch {
      return c.json({ user: null });
    }
  });

  return auth;
}
