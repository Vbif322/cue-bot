# TODO

Приоритеты по аудиту от 2026-06-12 (`audit/FINDINGS.md`, сводка —
`audit/stage-8-synthesis.md`)

## P2 — Техдолг / UX (Low)

- Прочий Low-долг (детали — `audit/FINDINGS.md`): S2-7…S2-10, S3-5…S3-7,
  S4-4, S4-5, S5-4, S5-5, S6-2, S6-3, S7-5

## Архитектура / инфраструктура

- Дизайн-система (частично): монорепо (npm workspaces: `admin`, `app`, `packages/*`) и пакет
  `packages/ui` (`@cue-bot/ui`) с дизайн-токенами (Tailwind v4 `@theme`) и презентационными
  примитивами (Badge/StatusBadge, InfoRow, Chevron, Button, Input/Select, Modal); админка и
  SPA игрока переведены на них. Осталось: по мере надобности выносить оставшиеся
  inline-паттерны и, если потребуется, не-UI общий код в `packages/shared`. Фиче-компоненты
  (`tournament-detail/*`, модалки, завязанные на TanStack Query) намеренно живут в `admin`/`app`.

## Веб для игроков (M1) — готово, см. ROADMAP.md

Реализовано: монорепо (`admin`, `app`, `packages/*`); `user_identities` + бэкфилл
telegram-аккаунтов (закрыло предусловие S2-2 из аудита); беспарольный вход — коды на почту
(`email_login_codes` + mailService) и Telegram Login Widget (`verifyTelegramLogin`,
`POST /api/app/auth/telegram`, привязка `POST /api/app/me/telegram`); JWT в куке `app_token`
+ `requireUser`; регистрация/отмена/приглашения извлечены из бот-хендлеров в
`tournamentService`; API игрока `/api/app/*` (auth, me, tournaments, matches, notifications);
SPA `app/`; раздача по поддоменам (игрок — cuebot.ru, админка — admin.cuebot.ru,
Host-диспетчеризация в Node).

Хвосты M1:

- Мост из бота на сайт игрока: команда бота (напр. `/site`), выдающая одноразовую
  ссылку по образцу админского `/dashboard` (`loginTokens`, TTL 5 мин), + публичный
  `GET /api/app/auth/token`, который тратит токен, ставит `app_token` любому юзеру
  (без проверки роли) и редиректит на `PUBLIC_BASE_URL`.
- Mini App initData (M6): второй источник входа, сходится в те же `user_identities`.
