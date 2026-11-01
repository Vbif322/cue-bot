import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Api } from 'grammy';
import type { UUID } from 'crypto';

import { federationRoles } from '@/db/schema.js';
import type { IFederationRole } from '@/db/schema.js';
import {
  addMember,
  createFederation,
  deleteFederation,
  getFederation,
  getUserFederations,
  listFederations,
  listMembers,
  removeMember,
  setMemberRole,
  updateFederation,
} from '@/services/federationService.js';
import { findUserByHandle } from '@/services/userService.js';
import {
  bindGroupChat,
  getGroupChat,
  listGroupChatsForFederation,
  unbindGroupChat,
} from '@/services/groupChatService.js';
import type { ApiFederationChat } from '@/bot/@types/federation.js';
import { canManageFederation } from '@/services/authz.js';
import { organizerCommands } from '@/bot/commands.js';
import { errorMessage } from '@/utils/errors.js';

import { requireAdmin, requireStaff } from '../middleware.js';
import type { AdminUser } from '../middleware.js';
import { validateParam, idParam, idUserIdParam } from './_shared.js';

const nameSchema = z.string().min(1).max(255);
const citySchema = z.string().min(1).max(100);
const descriptionSchema = z.string().max(2000).nullable().optional();

/**
 * Федерации (организаторы) в панели. Платформенный админ видит и правит все;
 * owner — свою (состав, настройки); organizer — только читает свою.
 */
export function createFederationsRouter(botApi: Api) {
  const router = new Hono();

  router.use('/*', requireStaff);

  const roleIn = (
    admin: AdminUser,
    federationId: UUID,
  ): IFederationRole | null => admin.federationRoles[federationId] ?? null;

  const isMember = (admin: AdminUser, federationId: UUID): boolean =>
    admin.isPlatformAdmin || roleIn(admin, federationId) !== null;

  // Admin: все федерации со счётчиками; staff: свои с ролью.
  router.get('/', async (c) => {
    const admin = c.get('adminUser');
    if (admin.isPlatformAdmin) {
      return c.json({ data: await listFederations() });
    }
    return c.json({ data: await getUserFederations(admin.id) });
  });

  // Создать федерацию. Админ может назначить владельцем другого (`ownerUsername`),
  // иначе владелец — сам актор. Остальные — только для себя, при действующем
  // праве организатора и с лимитом (платная опция, см. users.organizerUntil).
  router.post(
    '/',
    zValidator(
      'json',
      z.object({
        name: nameSchema,
        city: citySchema,
        description: descriptionSchema,
        ownerUsername: z.string().min(1).max(255).optional(),
      }),
    ),
    async (c) => {
      const admin = c.get('adminUser');
      const body = c.req.valid('json');

      let ownerId: UUID = admin.id;
      if (body.ownerUsername !== undefined) {
        if (!admin.isPlatformAdmin) {
          return c.json({ error: 'Недостаточно прав' }, 403);
        }
        const handle = body.ownerUsername.startsWith('@')
          ? body.ownerUsername
          : `@${body.ownerUsername}`;
        const owner = await findUserByHandle(handle);
        if (owner?.deletedAt !== null) {
          return c.json(
            {
              error: 'Пользователь не найден. Он должен сначала написать боту.',
            },
            404,
          );
        }
        ownerId = owner.id;
      }

      try {
        const federation = await createFederation({
          name: body.name,
          city: body.city,
          description: body.description ?? null,
          ownerId,
          createdBy: admin.id,
          selfService: !admin.isPlatformAdmin,
        });
        return c.json({ data: federation }, 201);
      } catch (error) {
        return c.json({ error: errorMessage(error) }, 400);
      }
    },
  );

  router.get('/:id', validateParam(idParam), async (c) => {
    const admin = c.get('adminUser');
    const { id } = c.req.valid('param');
    if (!isMember(admin, id)) return c.json({ error: 'Не найдена' }, 404);
    const federation = await getFederation(id);
    if (!federation) return c.json({ error: 'Не найдена' }, 404);
    return c.json({
      data: { ...federation, role: roleIn(admin, id) },
    });
  });

  router.patch(
    '/:id',
    validateParam(idParam),
    zValidator(
      'json',
      z
        .object({
          name: nameSchema.optional(),
          city: citySchema.optional(),
          description: descriptionSchema,
        })
        .refine((d) => Object.keys(d).length > 0, {
          message: 'At least one field required',
        }),
    ),
    async (c) => {
      const admin = c.get('adminUser');
      const { id } = c.req.valid('param');
      if (!isMember(admin, id)) return c.json({ error: 'Не найдена' }, 404);
      if (!canManageFederation(admin, roleIn(admin, id))) {
        return c.json(
          { error: 'Только владелец может менять организацию' },
          403,
        );
      }
      try {
        const updated = await updateFederation(id, c.req.valid('json'));
        if (!updated) return c.json({ error: 'Не найдена' }, 404);
        return c.json({ data: updated });
      } catch (error) {
        return c.json({ error: errorMessage(error) }, 400);
      }
    },
  );

  // Удаление — только платформенный админ; с турнирами/площадками — 409.
  router.delete('/:id', requireAdmin, validateParam(idParam), async (c) => {
    const { id } = c.req.valid('param');
    const outcome = await deleteFederation(id);
    if (outcome === 'not_found') return c.json({ error: 'Не найдена' }, 404);
    if (outcome === 'has_references') {
      return c.json(
        {
          error:
            'У организации есть турниры или площадки — сначала перенесите или удалите их',
        },
        409,
      );
    }
    return c.json({ ok: true });
  });

  // ── Состав ──────────────────────────────────────────────────────────────────

  router.get('/:id/members', validateParam(idParam), async (c) => {
    const admin = c.get('adminUser');
    const { id } = c.req.valid('param');
    if (!isMember(admin, id)) return c.json({ error: 'Не найдена' }, 404);
    return c.json({ data: await listMembers(id) });
  });

  // Добавить участника по @username (Telegram-аккаунт) или userId.
  router.post(
    '/:id/members',
    validateParam(idParam),
    zValidator(
      'json',
      z.union([
        z.object({
          username: z.string().min(1).max(255),
          role: z.enum(federationRoles).default('organizer'),
        }),
        z.object({
          userId: z.uuid(),
          role: z.enum(federationRoles).default('organizer'),
        }),
      ]),
    ),
    async (c) => {
      const admin = c.get('adminUser');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      if (!isMember(admin, id)) return c.json({ error: 'Не найдена' }, 404);
      if (!canManageFederation(admin, roleIn(admin, id))) {
        return c.json({ error: 'Только владелец может менять состав' }, 403);
      }

      let targetId: UUID;
      let telegramId: string | null = null;
      if ('username' in body) {
        const handle = body.username.startsWith('@')
          ? body.username
          : `@${body.username}`;
        const target = await findUserByHandle(handle);
        if (target?.deletedAt !== null) {
          return c.json(
            {
              error: 'Пользователь не найден. Он должен сначала написать боту.',
            },
            404,
          );
        }
        targetId = target.id;
        telegramId = target.telegram_id;
      } else {
        targetId = body.userId as UUID;
      }

      const outcome = await addMember(id, targetId, body.role);
      if (!outcome.ok) {
        if (outcome.reason === 'federation_not_found') {
          return c.json({ error: 'Не найдена' }, 404);
        }
        return c.json({ error: 'Уже в составе организации' }, 409);
      }

      // Новому организатору — уведомление и меню команд (как /assign_referee).
      if (telegramId) {
        const federation = await getFederation(id);
        const chatId = parseInt(telegramId, 10);
        try {
          await botApi.sendMessage(
            chatId,
            `Вас добавили в организацию «${federation?.name ?? ''}». ` +
              'Теперь вам доступны /create_tournament и /dashboard.',
          );
          await botApi.setMyCommands(organizerCommands, {
            scope: { type: 'chat', chat_id: chatId },
          });
        } catch (error) {
          console.error(
            'Не удалось уведомить организатора:',
            errorMessage(error),
          );
        }
      }

      return c.json({ data: await listMembers(id) }, 201);
    },
  );

  router.patch(
    '/:id/members/:userId',
    validateParam(idUserIdParam),
    zValidator('json', z.object({ role: z.enum(federationRoles) })),
    async (c) => {
      const admin = c.get('adminUser');
      const { id, userId } = c.req.valid('param');
      if (!isMember(admin, id)) return c.json({ error: 'Не найдена' }, 404);
      if (!canManageFederation(admin, roleIn(admin, id))) {
        return c.json({ error: 'Только владелец может менять состав' }, 403);
      }
      try {
        await setMemberRole(id, userId, c.req.valid('json').role);
        return c.json({ data: await listMembers(id) });
      } catch (error) {
        return c.json({ error: errorMessage(error) }, 409);
      }
    },
  );

  // Исключить участника; organizer может выйти сам.
  router.delete(
    '/:id/members/:userId',
    validateParam(idUserIdParam),
    async (c) => {
      const admin = c.get('adminUser');
      const { id, userId } = c.req.valid('param');
      if (!isMember(admin, id)) return c.json({ error: 'Не найдена' }, 404);
      const self = userId === admin.id;
      if (!self && !canManageFederation(admin, roleIn(admin, id))) {
        return c.json({ error: 'Только владелец может менять состав' }, 403);
      }
      try {
        await removeMember(id, userId);
        return c.json({ ok: true });
      } catch (error) {
        return c.json({ error: errorMessage(error) }, 409);
      }
    },
  );

  // ── Групповые чаты (анонсы) ────────────────────────────────────────────────
  // Привязанный чат слышит только турниры этой федерации; в непривязанный бот
  // не пишет. Кандидаты на привязку — чаты, добавленные кем-то из команды.

  router.get('/:id/chats', validateParam(idParam), async (c) => {
    const admin = c.get('adminUser');
    const { id } = c.req.valid('param');
    if (!isMember(admin, id)) return c.json({ error: 'Не найдена' }, 404);
    const chats = await listGroupChatsForFederation(id);
    const data: ApiFederationChat[] = chats.map((ch) => ({
      chatId: ch.chatId,
      title: ch.title,
      type: ch.type,
      isActive: ch.isActive,
      bound: ch.federationId === id,
    }));
    return c.json({ data });
  });

  const chatParam = z.object({
    id: z.uuid().transform((v) => v as UUID),
    chatId: z.string().min(1).max(32),
  });

  router.post(
    '/:id/chats/:chatId/bind',
    validateParam(chatParam),
    async (c) => {
      const admin = c.get('adminUser');
      const { id, chatId } = c.req.valid('param');
      if (!isMember(admin, id)) return c.json({ error: 'Не найдена' }, 404);
      if (!canManageFederation(admin, roleIn(admin, id))) {
        return c.json({ error: 'Только владелец может привязывать чаты' }, 403);
      }
      const chat = await getGroupChat(chatId);
      if (!chat) return c.json({ error: 'Чат не найден' }, 404);
      // Перепривязать чужой чат может только админ; свой/свободный — владелец.
      if (
        chat.federationId !== null &&
        chat.federationId !== id &&
        !admin.isPlatformAdmin
      ) {
        return c.json({ error: 'Чат привязан к другой организации' }, 409);
      }
      await bindGroupChat(chatId, id);
      return c.json({ ok: true });
    },
  );

  router.delete(
    '/:id/chats/:chatId/bind',
    validateParam(chatParam),
    async (c) => {
      const admin = c.get('adminUser');
      const { id, chatId } = c.req.valid('param');
      if (!isMember(admin, id)) return c.json({ error: 'Не найдена' }, 404);
      if (!canManageFederation(admin, roleIn(admin, id))) {
        return c.json({ error: 'Только владелец может отвязывать чаты' }, 403);
      }
      const chat = await getGroupChat(chatId);
      if (!chat || chat.federationId !== id) {
        return c.json({ error: 'Чат не привязан к этой организации' }, 404);
      }
      await unbindGroupChat(chatId);
      return c.json({ ok: true });
    },
  );

  return router;
}
