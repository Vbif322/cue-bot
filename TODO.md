# TODO

Приоритеты по аудиту от 2026-06-12 (`audit/FINDINGS.md`, сводка —
`audit/stage-8-synthesis.md`)

## P2 — Техдолг / UX (Low)

- Прочий Low-долг (детали — `audit/FINDINGS.md`): S2-7…S2-10, S3-5…S3-7,
  S4-4, S4-5, S5-4, S5-5, S6-2, S6-3, S7-5

## Архитектура / инфраструктура

- Дизайн-система: вынести переиспользуемые UI-компоненты из `admin/src/components/`
  (StatusBadge, Layout, модалки, `tournament-detail/*`) в общий пакет монорепо
  (`packages/shared`/`packages/ui`, см. M1) — для переиспользования в админке и
  будущем SPA игрока (`app/`).
- Webhook вместо long-polling: перевести бота с `bot.start()` (`src/index.ts`) на
  `webhookCallback` (grammY) на существующем Hono-сервере — публичный URL + secret,
  `setWebhook`, убрать polling-ретраи; в dev оставить polling-фолбэк.

## Веб для игроков (M1) — см. ROADMAP.md

Предусловия из аудита: S2-2 (идентичность — согласовать `user_identities` с переходом на telegram_id).

- Монорепо: npm workspaces (admin, app, packages/shared), один lockfile
- Идентичность: таблица user_identities + миграция и бэкфилл telegram-аккаунтов
- Email/пароль: bcryptjs, JWT в куке app_token, middleware requireUser
- Почта: mailService (nodemailer/SMTP) + таблица email_tokens (верификация/сброс)
- Извлечь регистрацию/отмену/приглашения из хендлеров бота в tournamentService
- API игрока /api/app/\* (auth, me, tournaments, matches, notifications)
- SPA app/ (лента турниров, карточка+сетка, мои турниры/матчи, профиль, уведомления)
- Раздача статики: игрок на /, админка переезжает на /admin
- Вход через Telegram на сайте (Login Widget / Mini App initData) в дополнение к
  email/паролю; переиспользовать код-/токен-мост (`src/admin/server/auth.ts`,
  `loginCodes`/`loginTokens`) и `user_identities`. Связано с M6.
