import { Composer } from 'grammy';
import { and, eq } from 'drizzle-orm';
import type { UUID } from 'crypto';

import { db } from '@/db/db.js';
import { users, tournaments, tournamentReferees } from '@/db/schema.js';
import { findUserByHandle } from '@/services/userService.js';

import { adminOnly } from '../guards.js';
import { adminCommands, refereeCommands, userCommands } from '../commands.js';
import { getUserRefereeTournaments } from '../permissions.js';
import type { BotContext } from '../types.js';

export const roleCommands = new Composer<BotContext>();

// /set_admin <telegram_id или @username> - назначить админа
roleCommands.command('set_admin', adminOnly(), async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1) ?? [];

  if (args.length === 0) {
    await ctx.reply(
      'Использование: /set_admin <telegram_id или @username>\n' +
        'Пример: /set_admin 123456789\n' +
        'Пример: /set_admin @username',
    );
    return;
  }

  const target = args[0];
  if (!target) return;

  const targetUser = await findUserByHandle(target);

  if (!targetUser) {
    await ctx.reply('Пользователь не найден. Он должен сначала написать боту.');
    return;
  }

  if (targetUser.role === 'admin') {
    await ctx.reply(`${targetUser.username} уже является администратором.`);
    return;
  }

  await db
    .update(users)
    .set({ role: 'admin' })
    .where(eq(users.id, targetUser.id));

  // Обновляем меню команд для нового админа
  if (targetUser.telegram_id) {
    await ctx.api.setMyCommands(adminCommands, {
      scope: { type: 'chat', chat_id: parseInt(targetUser.telegram_id, 10) },
    });
  }

  await ctx.reply(`${targetUser.username} теперь администратор.`);
});

// /remove_admin <telegram_id или @username> - снять админа
roleCommands.command('remove_admin', adminOnly(), async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1) ?? [];

  if (args.length === 0) {
    await ctx.reply(
      'Использование: /remove_admin <telegram_id или @username>\n' +
        'Пример: /remove_admin @username',
    );
    return;
  }

  const target = args[0];
  if (!target) return;

  const targetUser = await findUserByHandle(target);

  if (!targetUser) {
    await ctx.reply('Пользователь не найден.');
    return;
  }

  if (targetUser.id === ctx.dbUser.id) {
    await ctx.reply('Вы не можете снять права администратора с себя.');
    return;
  }

  if (targetUser.role !== 'admin') {
    await ctx.reply(`${targetUser.username} не является администратором.`);
    return;
  }

  await db
    .update(users)
    .set({ role: 'user' })
    .where(eq(users.id, targetUser.id));

  // Обновляем меню команд - убираем админские
  if (targetUser.telegram_id) {
    await ctx.api.setMyCommands(userCommands, {
      scope: { type: 'chat', chat_id: parseInt(targetUser.telegram_id, 10) },
    });
  }

  await ctx.reply(`${targetUser.username} больше не администратор.`);
});

// /assign_referee <tournament_id> <telegram_id/@username>
roleCommands.command('assign_referee', adminOnly(), async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1) ?? [];

  if (args.length < 2) {
    await ctx.reply(
      'Использование: /assign_referee <tournament_id> <telegram_id или @username>\n' +
        'Пример: /assign_referee abc-123 @username',
    );
    return;
  }

  const [tournamentId, targetArg] = args as [UUID, string];

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.reply('Турнир не найден.');
    return;
  }

  const targetUser = await findUserByHandle(targetArg);

  if (!targetUser) {
    await ctx.reply('Пользователь не найден.');
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

  // Promote target's menu to referee-level (admins already have everything)
  if (targetUser.telegram_id && targetUser.role !== 'admin') {
    const targetChatId = parseInt(targetUser.telegram_id, 10);
    await ctx.api.setMyCommands(refereeCommands, {
      scope: { type: 'chat', chat_id: targetChatId },
    });
    await ctx.api.sendMessage(
      targetChatId,
      `Вы назначены судьёй на турнир «${tournament.name}». ` +
        'В меню появилась команда /referee_matches.',
    );
  }

  await ctx.reply(
    `${targetUser.username} назначен судьей турнира "${tournament.name}".`,
  );
});

// /remove_referee <tournament_id> <telegram_id/@username>
roleCommands.command('remove_referee', adminOnly(), async (ctx) => {
  const args = ctx.message?.text.split(' ').slice(1) ?? [];

  if (args.length < 2) {
    await ctx.reply(
      'Использование: /remove_referee <tournament_id> <telegram_id или @username>\n' +
        'Пример: /remove_referee abc-123 @username',
    );
    return;
  }

  const [tournamentId, targetArg] = args as [UUID, string];

  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });

  if (!tournament) {
    await ctx.reply('Турнир не найден.');
    return;
  }

  const targetUser = await findUserByHandle(targetArg);

  if (!targetUser) {
    await ctx.reply('Пользователь не найден.');
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

  // If user has no remaining referee tournaments, downgrade their menu
  if (targetUser.telegram_id && targetUser.role !== 'admin') {
    const remaining = await getUserRefereeTournaments(targetUser.id);
    if (remaining.length === 0) {
      await ctx.api.setMyCommands(userCommands, {
        scope: {
          type: 'chat',
          chat_id: parseInt(targetUser.telegram_id, 10),
        },
      });
    }
  }

  await ctx.reply(
    `${targetUser.username} больше не судья турнира "${tournament.name}".`,
  );
});
