import { Composer, InlineKeyboard } from 'grammy';
import type { UUID } from 'crypto';

import {
  addMember,
  createFederation,
  getMembership,
  getUserFederations,
  listMembers,
  removeMember,
} from '@/services/federationService.js';
import { findUserByHandle } from '@/services/userService.js';
import {
  canCreateFederationWith,
  canManageFederation,
  isFederationActive,
} from '@/services/authz.js';
import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';
import { errorMessage } from '@/utils/errors.js';
import { escapeMarkdown } from '@/utils/messageHelpers.js';

import { organizerCommands } from '../commands.js';
import {
  registerTextSession,
  type TextMessageContext,
} from '../sessions/textSessionRegistry.js';
import { TextSessionStore } from '../sessions/textSessionStore.js';
import { TEXT_SESSION_TTL_MS } from '../sessions/textSession.const.js';
import type { BotContext } from '../types.js';

/**
 * Организации (федерации) в боте — минимум: создать свою (при платном праве
 * организатора, `users.organizerUntil`), посмотреть состав, добавить
 * организатора по @username. Роли, настройки, чаты — в панели (/dashboard).
 */
export const federationCommands = new Composer<BotContext>();

// ── /new_federation: название → город ─────────────────────────────────────────

const NO_GRANT_TEXT =
  'Создание организаций — платная опция. Чтобы проводить свои турниры, ' +
  'обратитесь к администратору платформы.';

function formatDay(date: Date): string {
  return DateTimeHelperInstance.formatDate(date, 'DD.MM.YYYY');
}

interface FederationCreateState {
  step: 'name' | 'city';
  name?: string;
}

const federationCreateState = new TextSessionStore<FederationCreateState>(
  'federation-create',
  { ttlMs: TEXT_SESSION_TTL_MS.federationCreate },
);

federationCommands.command('new_federation', async (ctx) => {
  const from = ctx.from;
  if (ctx.chat.type !== 'private' || !from) return;
  if (!canCreateFederationWith(ctx.dbUser)) {
    await ctx.reply(NO_GRANT_TEXT);
    return;
  }
  await federationCreateState.start(from.id, { step: 'name' }, ctx);
  await ctx.reply(
    'Создаём организацию (федерацию, клуб или просто «ваши турниры»).\n\n' +
      'Шаг 1 / 2. Введите название.\n\nДля отмены — /cancel',
  );
});

async function handleFederationCreateText(
  ctx: TextMessageContext,
  state: FederationCreateState,
): Promise<void> {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;

  if (state.step === 'name') {
    if (text.length < 2) {
      await ctx.reply('Название слишком короткое. Попробуйте ещё раз.');
      return;
    }
    await federationCreateState.update(userId, { step: 'city', name: text });
    await ctx.reply('Шаг 2 / 2. В каком городе вы проводите турниры?');
    return;
  }

  try {
    const federation = await createFederation({
      name: state.name ?? '',
      city: text,
      ownerId: ctx.dbUser.id,
      selfService: ctx.dbUser.role !== 'admin',
    });
    await federationCreateState.end(userId);
    await ctx.api.setMyCommands(organizerCommands, {
      scope: { type: 'chat', chat_id: userId },
    });
    await ctx.reply(
      `✅ Организация «${federation.name}» (${federation.city}) создана, вы — её владелец.\n\n` +
        'Что дальше:\n' +
        '• /create_tournament — создать турнир\n' +
        '• /my_federations — состав и приглашение организаторов\n' +
        '• /dashboard — панель управления в браузере (площадки, столы, участники)',
    );
  } catch (error) {
    await ctx.reply(`${errorMessage(error)}\nПопробуйте ещё раз или /cancel.`);
  }
}

registerTextSession({
  store: federationCreateState,
  name: 'создание организации',
  blocking: true,
  callbackPrefix: 'fed:',
  cancelReply: 'Создание организации отменено.',
  onText: handleFederationCreateText,
});

// ── /my_federations ────────────────────────────────────────────────────────────

const ROLE_LABELS = { owner: 'владелец', organizer: 'организатор' } as const;

async function renderMyFederations(ctx: BotContext): Promise<void> {
  const mine = await getUserFederations(ctx.dbUser.id);
  const canCreate = canCreateFederationWith(ctx.dbUser);
  if (mine.length === 0) {
    await ctx.reply(
      canCreate
        ? 'Вы пока не состоите ни в одной организации.\n' +
            'Создать свою: /new_federation'
        : `Вы пока не состоите ни в одной организации.\n\n${NO_GRANT_TEXT}`,
    );
    return;
  }
  const keyboard = new InlineKeyboard();
  let text = '🏛 *Мои организации*\n\n';
  for (const f of mine) {
    const term =
      f.activeUntil !== null && isFederationActive(f.activeUntil)
        ? `турниры до ${formatDay(f.activeUntil)}`
        : '⚠️ срок истёк, новые турниры недоступны';
    text += `• *${escapeMarkdown(f.name)}* — ${escapeMarkdown(f.city)}, ${ROLE_LABELS[f.role]}; ${term}\n`;
    keyboard.text(`👥 ${f.name}`, `fed:members:${f.id}`).row();
  }
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

federationCommands.command('my_federations', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  await renderMyFederations(ctx);
});

async function renderMembers(
  ctx: BotContext,
  federationId: UUID,
): Promise<void> {
  const [membership, members, mine] = await Promise.all([
    getMembership(ctx.dbUser.id, federationId),
    listMembers(federationId),
    getUserFederations(ctx.dbUser.id),
  ]);
  const federation = mine.find((f) => f.id === federationId);
  if (membership === null && ctx.dbUser.role !== 'admin') {
    await ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    return;
  }
  const manage = canManageFederation(ctx.dbUser, membership);

  let text = `👥 *${escapeMarkdown(federation?.name ?? 'Организация')}* — состав\n\n`;
  const keyboard = new InlineKeyboard();
  for (const m of members) {
    const display =
      [m.name, m.surname].filter(Boolean).join(' ') || `@${m.username}`;
    text += `• ${escapeMarkdown(display)} (@${escapeMarkdown(m.username)}) — ${ROLE_LABELS[m.role]}\n`;
    if (manage && m.userId !== ctx.dbUser.id) {
      keyboard
        .text(
          `🚫 Исключить @${m.username}`,
          `fed:rm:${federationId}:${m.userId}`,
        )
        .row();
    }
  }
  if (manage) {
    keyboard.text('➕ Добавить организатора', `fed:add:${federationId}`).row();
  }
  text += '\nРоли и настройки — в панели управления: /dashboard';

  await ctx.answerCallbackQuery();
  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

federationCommands.callbackQuery(/^fed:members:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  if (!id) return;
  await renderMembers(ctx, id as UUID);
});

federationCommands.callbackQuery(/^fed:rm:([^:]+):(.+)$/, async (ctx) => {
  const federationId = ctx.match[1] as UUID | undefined;
  const userId = ctx.match[2] as UUID | undefined;
  if (!federationId || !userId) return;
  const membership = await getMembership(ctx.dbUser.id, federationId);
  if (!canManageFederation(ctx.dbUser, membership)) {
    await ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    return;
  }
  try {
    await removeMember(federationId, userId);
    await ctx.answerCallbackQuery({ text: 'Исключён' });
  } catch (error) {
    await ctx.answerCallbackQuery({
      text: errorMessage(error),
      show_alert: true,
    });
    return;
  }
  await renderMembers(ctx, federationId);
});

// ── fed:add — мягкая сессия «@username» ────────────────────────────────────────

interface AddMemberState {
  federationId: UUID;
}

const addMemberState = new TextSessionStore<AddMemberState>(
  'federation-add-member',
  { ttlMs: TEXT_SESSION_TTL_MS.invite },
);

federationCommands.callbackQuery(/^fed:add:(.+)$/, async (ctx) => {
  const federationId = ctx.match[1] as UUID | undefined;
  if (!federationId) return;
  const membership = await getMembership(ctx.dbUser.id, federationId);
  if (!canManageFederation(ctx.dbUser, membership)) {
    await ctx.answerCallbackQuery({ text: 'Нет доступа', show_alert: true });
    return;
  }
  await addMemberState.start(ctx.from.id, { federationId }, ctx);
  await ctx.answerCallbackQuery();
  await ctx.reply(
    'Отправьте @username пользователя, которого хотите сделать организатором ' +
      '(он должен хотя бы раз написать боту).\n\nЧтобы отменить — /cancel',
  );
});

async function handleAddMemberText(
  ctx: TextMessageContext,
  state: AddMemberState,
): Promise<void> {
  await addMemberState.end(ctx.from.id);

  const handle = ctx.message.text.trim().replace(/^@/, '');
  if (!handle) {
    await ctx.reply(
      'Пустой username. Нажмите «Добавить организатора» ещё раз.',
    );
    return;
  }
  const membership = await getMembership(ctx.dbUser.id, state.federationId);
  if (!canManageFederation(ctx.dbUser, membership)) {
    await ctx.reply('Нет доступа.');
    return;
  }

  const target = await findUserByHandle(`@${handle}`);
  if (target?.deletedAt !== null) {
    await ctx.reply(
      `Пользователь @${handle} не найден в боте — он должен сначала запустить бота.`,
    );
    return;
  }

  const outcome = await addMember(state.federationId, target.id, 'organizer');
  if (!outcome.ok) {
    await ctx.reply(
      outcome.reason === 'already_member'
        ? `@${handle} уже в составе организации.`
        : 'Организация не найдена.',
    );
    return;
  }

  const mine = await getUserFederations(ctx.dbUser.id);
  const name = mine.find((f) => f.id === state.federationId)?.name ?? '';
  if (target.telegram_id) {
    const chatId = parseInt(target.telegram_id, 10);
    try {
      await ctx.api.sendMessage(
        chatId,
        `Вас добавили в организацию «${name}». ` +
          'Теперь вам доступны /create_tournament и /dashboard.',
      );
      await ctx.api.setMyCommands(organizerCommands, {
        scope: { type: 'chat', chat_id: chatId },
      });
    } catch (error) {
      console.error('Не удалось уведомить организатора:', errorMessage(error));
    }
  }
  await ctx.reply(`✅ @${handle} теперь организатор в «${name}».`);
}

registerTextSession({
  store: addMemberState,
  name: 'добавление организатора',
  blocking: false,
  cancelReply: 'Добавление организатора отменено.',
  onText: handleAddMemberText,
});
