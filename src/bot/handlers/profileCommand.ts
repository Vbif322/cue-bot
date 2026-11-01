import { Composer, InlineKeyboard } from 'grammy';

import {
  getUserCompletedTournaments,
  getUserMatchStats,
  type UserTournamentHistoryItem,
} from '@/services/userStatsService.js';
import { formatStats } from '../ui/profileUI.js';
import { getUserRefereeTournaments } from '../permissions.js';
import { getFederationIdsOf } from '@/services/federationService.js';
import type { BotContext } from '../types.js';
import { escapeMarkdown, formatFullName } from '@/utils/messageHelpers.js';
import {
  ProfileValidationError,
  updateUserProfile,
} from '@/services/userService.js';
import {
  confirmEmailLink,
  getVerifiedEmail,
  requestEmailLinkCode,
} from '@/services/emailLinkService.js';
import { profileEditStateStore } from '../wizards/profileEdit/profileEdit.module.js';
import type { ProfileEditState } from '../wizards/profileEdit/profileEdit.stateStore.js';
import { emailLinkStateStore } from '../wizards/emailLink/emailLink.module.js';
import type { EmailLinkState } from '../wizards/emailLink/emailLink.stateStore.js';
import {
  registerTextSession,
  type TextMessageContext,
} from '../sessions/textSessionRegistry.js';
import { hasOrganizerGrant } from '@/services/authz.js';
import { DateTimeHelperInstance } from '@/utils/dateTimeHelper.js';

export const profileCommands = new Composer<BotContext>();

function pluralizeTournaments(n: number): string {
  const isSingular = n % 10 === 1 && n % 100 !== 11;
  return isSingular ? 'турнире' : 'турнирах';
}

function formatProfileHeader(
  ctx: BotContext,
  refereeCount: number,
  federationCount: number,
  verifiedEmail: string | null,
): string {
  const user = ctx.dbUser;
  const displayName = formatFullName(user.name, user.surname) ?? user.username;
  const usernameLine = user.username ? ` (@${user.username})` : '';

  let role: string;
  if (user.role === 'admin') {
    role = 'Админ';
  } else if (federationCount > 0 || hasOrganizerGrant(user)) {
    role = 'Организатор';
  } else if (refereeCount > 0) {
    role = `Судья на ${String(refereeCount)} ${pluralizeTournaments(refereeCount)}`;
  } else {
    role = 'Игрок';
  }

  const cityLine = user.city ? `\n📍 Город: ${user.city}` : '';
  const emailLine = verifiedEmail
    ? `\n📧 Почта: ${escapeMarkdown(verifiedEmail)}`
    : '';
  return `👤 *${displayName}*${usernameLine}\n🎭 Роль: ${role}${cityLine}${emailLine}${formatGrantLine(user.organizerUntil)}`;
}

/** Срок платного права организатора (`users.organizerUntil`), если выдавалось. */
function formatGrantLine(until: Date | null): string {
  if (until === null) return '';
  const day = DateTimeHelperInstance.formatDate(until, 'DD.MM.YYYY');
  return until > new Date()
    ? `\n🏛 Право организатора до ${day}`
    : `\n🏛 Право организатора истекло ${day}`;
}

function formatHistory(history: UserTournamentHistoryItem[]): string {
  if (history.length === 0) {
    return '';
  }
  let text = '📜 *История последних турниров*\n';
  for (const t of history) {
    const emoji = t.isWinner ? '🏆' : '▫️';
    text += `${emoji} ${t.name}\n`;
  }
  return text.trimEnd();
}

export async function showProfile(ctx: BotContext): Promise<void> {
  const userId = ctx.dbUser.id;

  const [stats, history, refereeTournaments, federationIds, verifiedEmail] =
    await Promise.all([
      getUserMatchStats(userId),
      getUserCompletedTournaments(userId, 5),
      getUserRefereeTournaments(userId),
      getFederationIdsOf(userId),
      getVerifiedEmail(userId),
    ]);

  const blocks: string[] = [];
  blocks.push(
    formatProfileHeader(
      ctx,
      refereeTournaments.length,
      federationIds.length,
      verifiedEmail,
    ),
  );
  blocks.push(formatStats(stats));

  const historyBlock = formatHistory(history);
  if (historyBlock) {
    blocks.push(historyBlock);
  } else if (stats.played === 0) {
    blocks.push(
      'Откройте 📋 «Турниры», чтобы записаться на свой первый турнир.',
    );
  }

  const text = blocks.join('\n\n');

  const keyboard = new InlineKeyboard();
  keyboard
    .text('✏️ Изменить имя', 'pe:edit:name')
    .text('✏️ Изменить фамилию', 'pe:edit:surname')
    .row()
    .text(
      ctx.dbUser.city ? `📍 Город: ${ctx.dbUser.city}` : '📍 Указать город',
      'pe:edit:city',
    )
    .row();
  if (!verifiedEmail) {
    keyboard.text('📧 Привязать почту', 'pe:email').row();
  }
  for (const t of history) {
    keyboard.text(`📊 ${t.name}`, `bracket:view:${t.id}`).row();
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

profileCommands.command('me', (ctx) => showProfile(ctx));

const FIELD_LABELS: Record<'name' | 'surname' | 'city', string> = {
  name: 'имя',
  surname: 'фамилию',
  city: 'город',
};

profileCommands.callbackQuery(/^pe:edit:(name|surname|city)$/, async (ctx) => {
  const userId = ctx.from.id;
  const field = ctx.match[1] as 'name' | 'surname' | 'city';
  await profileEditStateStore.start(userId, field, ctx);

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `Отправьте новое значение (${FIELD_LABELS[field]}) сообщением.\n` +
      'Чтобы очистить — отправьте «-». Для отмены — /cancel.',
  );
});

/** Новое значение поля профиля (из единого диспетчера текстовых сессий). */
async function handleProfileEditText(
  ctx: TextMessageContext,
  state: ProfileEditState,
): Promise<void> {
  const raw = ctx.message.text.trim();
  const value = raw === '-' ? null : raw;

  try {
    const updated = await updateUserProfile(ctx.dbUser.id, {
      [state.field]: value,
    });
    ctx.dbUser = updated;
    await profileEditStateStore.clear(ctx.from.id);
    await ctx.reply('✅ Профиль обновлён.');
    await showProfile(ctx);
  } catch (error) {
    if (error instanceof ProfileValidationError) {
      await ctx.reply(`${error.message}\nПопробуйте ещё раз или /cancel.`);
      return;
    }
    throw error;
  }
}

registerTextSession({
  store: profileEditStateStore.session,
  name: 'редактирование профиля',
  blocking: true,
  callbackPrefix: 'pe:',
  cancelReply: 'Редактирование профиля отменено.',
  onText: handleProfileEditText,
});

// ── Привязка почты (вход на сайт и в админку по коду) ─────────────────────────
// Два шага в одной текстовой сессии: адрес → 6-значный код из письма. Логика
// общая с сайтом игрока — `emailLinkService`.

const emailCodeKeyboard = new InlineKeyboard()
  .text('🔁 Отправить код ещё раз', 'el:resend')
  .row()
  .text('✏️ Другой адрес', 'el:change');

const EXISTS_HINT =
  'Если это ваш аккаунт на сайте — войдите на сайт по этой почте и привяжите ' +
  'Telegram в профиле: аккаунты объединятся.';

function codeSentText(email: string): string {
  return (
    `✉️ Код отправлен на ${email}.\n` +
    'Отправьте 6 цифр из письма сообщением. Код действует 10 минут; ' +
    'если письма нет — проверьте папку «Спам».\nДля отмены — /cancel.'
  );
}

profileCommands.callbackQuery('pe:email', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (await getVerifiedEmail(ctx.dbUser.id)) {
    await ctx.reply('Почта уже привязана.');
    return;
  }
  await emailLinkStateStore.start(ctx.from.id, ctx);
  await ctx.reply(
    '📧 Отправьте адрес почты сообщением — пришлём на него код подтверждения.\n' +
      'После привязки по этой почте можно входить на сайт. Для отмены — /cancel.',
  );
});

profileCommands.callbackQuery('el:resend', async (ctx) => {
  const state = await emailLinkStateStore.get(ctx.from.id);
  if (state?.step !== 'code') {
    await ctx.answerCallbackQuery({
      text: 'Привязка почты не активна — начните заново из профиля.',
    });
    return;
  }
  const result = await requestEmailLinkCode(ctx.dbUser.id, state.email);
  await ctx.answerCallbackQuery();
  if (!result.success) {
    await ctx.reply(`❌ ${result.error}`);
    return;
  }
  await ctx.reply(codeSentText(result.email), {
    reply_markup: emailCodeKeyboard,
  });
});

profileCommands.callbackQuery('el:change', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await emailLinkStateStore.awaitEmail(ctx.from.id))) {
    await ctx.reply('Привязка почты не активна — начните заново из профиля.');
    return;
  }
  await ctx.reply(
    'Отправьте другой адрес почты сообщением. Для отмены — /cancel.',
  );
});

/** Адрес или код привязки почты (из единого диспетчера текстовых сессий). */
async function handleEmailLinkText(
  ctx: TextMessageContext,
  state: EmailLinkState,
): Promise<void> {
  const text = ctx.message.text.trim();

  if (state.step === 'email') {
    const result = await requestEmailLinkCode(ctx.dbUser.id, text);
    if (!result.success) {
      if (result.reason === 'already_linked' || result.reason === 'has_other') {
        await emailLinkStateStore.clear(ctx.from.id);
        await ctx.reply(`❌ ${result.error}`);
        return;
      }
      const hint = result.reason === 'exists' ? `\n${EXISTS_HINT}` : '';
      await ctx.reply(
        `❌ ${result.error}${hint}\nОтправьте другой адрес или /cancel.`,
      );
      return;
    }
    if (!(await emailLinkStateStore.awaitCode(ctx.from.id, result.email))) {
      return; // сессию успели отменить — не продолжаем
    }
    await ctx.reply(codeSentText(result.email), {
      reply_markup: emailCodeKeyboard,
    });
    return;
  }

  if (!/^\d{6}$/.test(text)) {
    await ctx.reply('Отправьте код из письма — 6 цифр. Для отмены — /cancel.');
    return;
  }

  const result = await confirmEmailLink(ctx.dbUser.id, state.email, text);
  if (!result.success) {
    if (result.reason === 'invalid_code') {
      await ctx.reply(
        '❌ Неверный или просроченный код. Попробуйте ещё раз или запросите новый.',
        { reply_markup: emailCodeKeyboard },
      );
      return;
    }
    // Почта успела уйти другому аккаунту / привязана другая — дальше идти некуда.
    await emailLinkStateStore.clear(ctx.from.id);
    const hint = result.reason === 'exists' ? `\n${EXISTS_HINT}` : '';
    await ctx.reply(`❌ ${result.error}${hint}`);
    return;
  }

  await emailLinkStateStore.clear(ctx.from.id);
  // linkEmailToUser заполняет users.email, только если он был пуст.
  ctx.dbUser = { ...ctx.dbUser, email: ctx.dbUser.email ?? result.email };
  await ctx.reply(
    `✅ Почта ${result.email} привязана. Теперь по коду на неё можно входить на сайт.`,
  );
  await showProfile(ctx);
}

registerTextSession({
  store: emailLinkStateStore.session,
  name: 'привязка почты',
  blocking: true,
  callbackPrefix: 'el:',
  cancelReply: 'Привязка почты отменена.',
  onText: handleEmailLinkText,
});
