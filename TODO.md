# TODO

Приоритеты по аудиту от 2026-06-12 (`audit/FINDINGS.md`, сводка —
`audit/stage-8-synthesis.md`)

## P1 — Ближайшие итерации (Medium)

Данные / БД:

- S5-3 enum-колонки без CHECK/pg-enum

Безопасность:

- S2-3 Rate limiting (`/request-code` и защита бота от флуда)

Качество кода:

- S3-1…S3-4 Мёртвый код, дубли в notificationService, толстые хендлеры,
  единая конвенция ошибок

Фичи / документация:

- S4-9 Реализовать или вычеркнуть DQ/лист ожидания/напоминания
  (вернуть/переписать `timeoutService` — S1-4)
- S0-6 Синхронизировать TECHNICAL_DOCUMENTATION/BUSINESS_REQUIREMENTS с кодом

## P2 — Техдолг / UX (Low)

- Сворачивание раундов в админке (моё)
- S7-3 Тесты конкурентности; S7-4 пороги покрытия + git-хуки
- Прочий Low-долг (детали — `audit/FINDINGS.md`): S0-4, S1-6, S1-7,
  S2-7…S2-10, S3-5…S3-7, S4-4, S4-5, S5-4, S5-5, S6-2, S6-3, S7-5

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
