import { Composer } from "grammy";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/db.js";
import { users, tournaments, tournamentReferees } from "../../db/schema.js";
import type { BotContext } from "../types.js";
import { adminOnly } from "../guards.js";
import { adminCommands, userCommands } from "../commands.js";

export const roleCommands = new Composer<BotContext>();

// TODO: Переделать на команду /me. Показывать еще статистику пользователя (рейтинг, количество сыгранных матчей, винрейт, количество побед и поражений и т.д.).
// /my_role - показать свою роль
// roleCommands.command("my_role", async (ctx) => {
//   const { dbUser } = ctx;

//   let message = `Ваша роль: ${dbUser.role}`;

//   const refereeTournamentIds = await getUserRefereeTournaments(dbUser.id);

//   if (refereeTournamentIds.length > 0) {
//     const tournamentsData = await db.query.tournaments.findMany({
//       where: (t, { inArray }) => inArray(t.id, refereeTournamentIds),
//     });

//     message += "\n\nВы судья на турнирах:";
//     for (const t of tournamentsData) {
//       message += `\n- ${t.name}`;
//     }
//   }

//   await ctx.reply(message);
// });

// /set_admin <telegram_id или @username> - назначить админа
roleCommands.command("set_admin", adminOnly(), async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);

  if (!args || args.length === 0) {
    await ctx.reply(
      "Использование: /set_admin <telegram_id или @username>\n" +
        "Пример: /set_admin 123456789\n" +
        "Пример: /set_admin @username",
    );
    return;
  }

  const target = args[0]!;
  let targetUser;

  if (target.startsWith("@")) {
    const username = target.slice(1);
    targetUser = await db.query.users.findFirst({
      where: eq(users.username, username),
    });
  } else {
    targetUser = await db.query.users.findFirst({
      where: eq(users.telegram_id, target),
    });
  }

  if (!targetUser) {
    await ctx.reply("Пользователь не найден. Он должен сначала написать боту.");
    return;
  }

  if (targetUser.role === "admin") {
    await ctx.reply(`${targetUser.username} уже является администратором.`);
    return;
  }

  await db
    .update(users)
    .set({ role: "admin" })
    .where(eq(users.id, targetUser.id));

  // Обновляем меню команд для нового админа
  await ctx.api.setMyCommands(adminCommands, {
    scope: { type: "chat", chat_id: parseInt(targetUser.telegram_id) },
  });

  await ctx.reply(`${targetUser.username} теперь администратор.`);
});

// /remove_admin <telegram_id или @username> - снять админа
roleCommands.command("remove_admin", adminOnly(), async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);

  if (!args || args.length === 0) {
    await ctx.reply(
      "Использование: /remove_admin <telegram_id или @username>\n" +
        "Пример: /remove_admin @username",
    );
    return;
  }

  const target = args[0]!;
  let targetUser;

  if (target.startsWith("@")) {
    targetUser = await db.query.users.findFirst({
      where: eq(users.username, target.slice(1)),
    });
  } else {
    targetUser = await db.query.users.findFirst({
      where: eq(users.telegram_id, target),
    });
  }

  if (!targetUser) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  if (targetUser.id === ctx.dbUser.id) {
    await ctx.reply("Вы не можете снять права администратора с себя.");
    return;
  }

  if (targetUser.role !== "admin") {
    await ctx.reply(`${targetUser.username} не является администратором.`);
    return;
  }

  await db
    .update(users)
    .set({ role: "user" })
    .where(eq(users.id, targetUser.id));

  // Обновляем меню команд - убираем админские
  await ctx.api.setMyCommands(userCommands, {
    scope: { type: "chat", chat_id: parseInt(targetUser.telegram_id) },
  });

  await ctx.reply(`${targetUser.username} больше не администратор.`);
});

// /assign_referee <tournament_id> <telegram_id/@username>
roleCommands.command("assign_referee", adminOnly(), async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);

  if (!args || args.length < 2) {
    await ctx.reply(
      "Использование: /assign_referee <tournament_id> <telegram_id или @username>\n" +
        "Пример: /assign_referee abc-123 @username",
    );
    return;
  }

  const [tournamentId, targetArg] = args as [string, string];

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.reply("Турнир не найден.");
    return;
  }

  let targetUser;
  if (targetArg.startsWith("@")) {
    targetUser = await db.query.users.findFirst({
      where: eq(users.username, targetArg.slice(1)),
    });
  } else {
    targetUser = await db.query.users.findFirst({
      where: eq(users.telegram_id, targetArg),
    });
  }

  if (!targetUser) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  const existing = await db.query.tournamentReferees.findFirst({
    where: and(
      eq(tournamentReferees.tournamentId, tournamentId),
      eq(tournamentReferees.userId, targetUser.id),
    ),
  });

  if (existing) {
    await ctx.reply(
      `${targetUser.username} уже является судьей турнира "${tournament.name}".`,
    );
    return;
  }

  await db.insert(tournamentReferees).values({
    tournamentId,
    userId: targetUser.id,
  });

  await ctx.reply(
    `${targetUser.username} назначен судьей турнира "${tournament.name}".`,
  );
});

// /remove_referee <tournament_id> <telegram_id/@username>
roleCommands.command("remove_referee", adminOnly(), async (ctx) => {
  const args = ctx.message?.text?.split(" ").slice(1);

  if (!args || args.length < 2) {
    await ctx.reply(
      "Использование: /remove_referee <tournament_id> <telegram_id или @username>\n" +
        "Пример: /remove_referee abc-123 @username",
    );
    return;
  }

  const [tournamentId, targetArg] = args as [string, string];

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.reply("Турнир не найден.");
    return;
  }

  let targetUser;
  if (targetArg.startsWith("@")) {
    targetUser = await db.query.users.findFirst({
      where: eq(users.username, targetArg.slice(1)),
    });
  } else {
    targetUser = await db.query.users.findFirst({
      where: eq(users.telegram_id, targetArg),
    });
  }

  if (!targetUser) {
    await ctx.reply("Пользователь не найден.");
    return;
  }

  await db
    .delete(tournamentReferees)
    .where(
      and(
        eq(tournamentReferees.tournamentId, tournamentId),
        eq(tournamentReferees.userId, targetUser.id),
      ),
    );

  await ctx.reply(
    `${targetUser.username} больше не судья турнира "${tournament.name}".`,
  );
});
