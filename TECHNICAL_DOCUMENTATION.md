# Техническая документация Cue Bot

## Содержание

1. [Обзор системы](#обзор-системы)
2. [Архитектура проекта](#архитектура-проекта)
3. [Модель данных](#модель-данных)
4. [Схемы пользовательских путей](#схемы-пользовательских-путей)
5. [API и команды бота](#api-и-команды-бота)
6. [Бизнес-логика](#бизнес-логика)
7. [Админ-панель](#админ-панель)

---

## Обзор системы

**Cue Bot** — Telegram-бот для автоматизации проведения турниров по бильярду. Система обеспечивает полный цикл управления турниром: от создания и регистрации участников до проведения матчей и определения победителя. Дополнительно предоставляется веб-интерфейс для администраторов.

### Технологический стек

- **Runtime**: Node.js + TypeScript
- **Telegram Bot Framework**: Grammy
- **База данных**: PostgreSQL
- **ORM**: Drizzle ORM
- **HTTP API**: Hono (для admin-панели)
- **Фронтенд**: React + Vite (SPA)
- **Dev tools**: Nodemon

### Основные возможности

- Создание и управление турнирами (через бота и через admin-панель)
- Регистрация участников на турниры
- Автоматическая генерация турнирной сетки
- Внесение и подтверждение результатов матчей
- Система технических результатов
- Управление ролями (admin, user) и судьями
- Управление физическими столами (привязка к турнирам)
- Система push-уведомлений участникам через Telegram
- Веб-панель для администраторов с JWT-аутентификацией

---

## Архитектура проекта

### Структура директорий

```
cue-bot/
├── src/
│   ├── bot/
│   │   ├── @types/         # TypeScript-типы
│   │   ├── handlers/       # Обработчики команд бота
│   │   ├── middleware/     # Middleware (аутентификация)
│   │   ├── ui/             # UI-компоненты (клавиатуры, сообщения)
│   │   ├── wizards/        # Мастер создания турнира
│   │   ├── commands.ts     # Регистрация команд
│   │   ├── guards.ts       # Защита маршрутов
│   │   ├── instance.ts     # Singleton-экземпляр бота
│   │   └── permissions.ts  # Проверка прав
│   ├── db/
│   │   ├── schema/         # Схемы таблиц (отдельные файлы)
│   │   ├── db.ts           # Подключение к БД
│   │   └── schema.ts       # Реэкспорт всех схем
│   ├── services/           # Бизнес-логика
│   │   ├── bracketGenerator.ts
│   │   ├── matchService.ts
│   │   ├── tournamentService.ts
│   │   ├── tournamentStartService.ts
│   │   ├── notificationService.ts
│   │   ├── timeoutService.ts
│   │   └── tableService.ts
│   ├── admin/
│   │   └── server/
│   │       ├── routes/     # API-маршруты (tournaments, matches, users, tables)
│   │       ├── index.ts    # Hono-приложение
│   │       ├── auth.ts     # Аутентификация (коды, JWT)
│   │       ├── middleware.ts # JWT-проверка
│   │       └── apiTypes.ts # Общие типы запросов/ответов
│   ├── utils/              # Вспомогательные утилиты
│   └── index.ts            # Точка входа (запуск бота + HTTP-сервера)
├── admin/                  # Отдельный Vite-проект (React SPA)
│   ├── src/
│   │   ├── pages/          # Страницы: Dashboard, Tournaments, Matches, Users, Tables
│   │   └── components/     # Общие компоненты
│   ├── package.json
│   └── vite.config.ts
└── drizzle.config.ts
```

### Слои приложения

```
┌────────────────────────────────────────────────────┐
│     Telegram Bot (Grammy)    │   React SPA (Vite)   │
└──────────────┬───────────────┴─────────┬────────────┘
               │                         │ HTTP
┌──────────────▼─────────────────────────▼────────────┐
│                  index.ts                            │
│         (Grammy bot + Hono HTTP server)              │
└──────────────┬──────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────┐
│           Middleware / Guards                        │
│   (authMiddleware, adminOnly, JWT verify)            │
└──────────────┬──────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────┐
│     Command Handlers  /  API Routes                  │
└──────────────┬──────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────┐
│              Service Layer                           │
│  (tournamentService, matchService, bracketGenerator, │
│   notificationService, tableService, ...)            │
└──────────────┬──────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────┐
│          Drizzle ORM + PostgreSQL                    │
└─────────────────────────────────────────────────────┘
```

### Запуск и сборка

| Команда | Описание |
|---------|----------|
| `npm run dev` | Бот + API-сервер (nodemon, порт из `ADMIN_PORT`) |
| `npm run dev:admin` | Vite dev-сервер SPA (порт 5173, прокси → 3000) |
| `npm run build:admin` | Сборка SPA в `admin/dist/` (раздаётся Hono в продакшне) |
| `npm run build` | Компиляция TypeScript серверного кода |

### Переменные окружения

| Переменная | Описание |
|------------|----------|
| `BOT_TOKEN` | Токен Telegram-бота |
| `DATABASE_URL` | Строка подключения к PostgreSQL |
| `JWT_SECRET` | Секрет для подписи JWT (admin-панель) |
| `ADMIN_PORT` | Порт HTTP-сервера (по умолчанию 3000) |
| `NODE_ENV` | `development` / `production` |

---

## Модель данных

### Диаграмма базы данных

```
┌─────────────┐
│    users    │
├─────────────┤
│ id (PK)     │◄──────────────────────────────┐
│ telegram_id │                               │
│ username    │                               │
│ name        │                               │
│ surname     │                               │
│ role        │                               │
│ email       │                               │
│ phone       │                               │
│ birthday    │                               │
└──────┬──────┘                               │
       │                                      │
  ┌────┴───────────────────────────────┐      │
  │                 │                  │      │
  ▼                 ▼                  ▼      │
┌──────────────┐ ┌──────────────────┐  │      │
│  tournaments │ │ tournamentReferees│  │      │
├──────────────┤ ├──────────────────┤  │      │
│ id (PK)      │ │ tournamentId (FK) │  │      │
│ name         │ │ userId (FK)       │  │      │
│ discipline   │ └──────────────────┘  │      │
│ format       │                       │      │
│ status       │                       │      │
│ startDate    │                       │      │
│ maxParticipants                      │      │
│ winScore     │                       │      │
│ createdBy(FK)│───────────────────────┘      │
│ rules        │                              │
│ description  │                              │
└──────┬───────┘                              │
       │                                      │
  ┌────┴──────────────────────────────────┐   │
  │                  │                    │   │
  ▼                  ▼                    ▼   │
┌──────────────────┐ ┌──────────┐ ┌──────────────────┐
│tournamentPartic. │ │tournament│ │ disqualifications│
├──────────────────┤ │ Tables   │ ├──────────────────┤
│ id (PK)          │ ├──────────┤ │ id (PK)          │
│ tournamentId(FK) │ │tournament│ │ tournamentId (FK)│
│ userId (FK)      │ │Id (FK)   │ │ userId (FK)      │
│ seed             │ │tableId   │ │ reason           │
│ status           │ │(FK)      │ │ disqualifiedBy   │
│ createdAt        │ │position  │ └──────────────────┘
└──────────────────┘ └──────────┘
                                 ┌──────────────┐
┌──────────┐                     │    matches   │
│  tables  │                     ├──────────────┤
├──────────┤                     │ id (PK)      │
│ id (PK)  │                     │ tournamentId │
│ name     │                     │ player1Id    │
│ venueId  │                     │ player2Id    │
└──────────┘                     │ winnerId     │
                                 │ round        │
                                 │ position     │
                                 │ bracketType  │
                                 │ nextMatchId  │
                                 │ player1Score │
                                 │ player2Score │
                                 │ status       │
                                 │ reportedBy   │
                                 │ confirmedBy  │
                                 │ isTechnical  │
                                 │ technicalReason│
                                 │ startedAt    │
                                 │ completedAt  │
                                 └──────────────┘

┌─────────────────────────────────────────┐
│           notifications                 │
├─────────────────────────────────────────┤
│ id, userId, type, title, message        │
│ tournamentId, matchId                   │
│ isSent, isRead, sentAt, createdAt       │
└─────────────────────────────────────────┘

┌───────────────────────────────────────┐
│  loginCodes          loginTokens      │
├───────────────────────────────────────┤
│ username / token, code/token          │
│ expiresAt, attempts                   │
└───────────────────────────────────────┘
```

### Описание таблиц

#### users
Пользователи бота.

- **telegram_id**: Уникальный ID Telegram
- **username**: @username в Telegram
- **role**: `user` | `admin`

#### tournaments
Турниры.

- **discipline**: `snooker`
- **format**: `single_elimination` | `double_elimination` | `round_robin`
- **status**: `draft` → `registration_open` → `registration_closed` → `in_progress` → `completed` / `cancelled`
- **winScore**: До скольки побед играется каждый матч

#### tournamentParticipants
Регистрации участников.

- **seed**: Порядковый номер в сетке (назначается при старте турнира)
- **status**: `pending` | `confirmed` | `cancelled`

#### matches
Матчи.

- **bracketType**: `winners` | `losers` | `grand_final`
- **nextMatchId**: FK на следующий матч (null для финала)
- **status**: `scheduled` | `in_progress` | `pending_confirmation` | `completed` | `cancelled`
- **isTechnicalResult**: признак технического результата

#### tournamentReferees
Судьи турниров (составная PK: tournamentId + userId).

#### tournamentTables
Привязка физических столов к турниру (составная PK: tournamentId + tableId), с сортировкой по position.

#### tables
Физические бильярдные столы (name, опциональный venueId).

#### notifications
Уведомления пользователям.

- **type**: `bracket_formed` | `match_reminder` | `result_confirmation_request` | `result_confirmed` | `result_dispute` | `tournament_results` | `disqualification`
- **isSent**: отправлено ли в Telegram
- **isRead**: прочитано ли

#### loginCodes
Одноразовые 6-значные коды для входа в admin-панель (TTL 5 мин, max 5 попыток).

#### loginTokens
Одноразовые URL-токены для входа (альтернативный способ — через ссылку из Telegram).

---

## Схемы пользовательских путей

### 1. Первый запуск бота

```
/start
  └─► authMiddleware (создаёт запись в БД если нет)
        └─► Проверка роли
              ├─► admin → установка административных команд
              └─► user  → установка пользовательских команд
```

- Middleware создаёт пользователя с ролью `user` при первом обращении
- При каждом запросе синхронизирует username и telegram_id

### 2. Создание турнира (Администратор)

Команда `/create_tournament` запускает многошаговый wizard:

1. **Название** (текстовый ввод)
2. **Дата** (текстовый ввод с парсингом)
3. **Дисциплина** (inline-кнопки)
4. **Формат** (inline-кнопки)
5. **Максимум участников** (inline-кнопки: 8, 16, 32, 64, 128)
6. **До скольки побед** (inline-кнопки)

После завершения: турнир создаётся со статусом `draft`. Команда `/cancel` в любой момент прерывает создание.

Состояние wizard хранится в памяти (Map) и очищается при завершении или отмене.

### 3. Жизненный цикл турнира (Администратор)

```
draft
  └─► "Открыть регистрацию" → registration_open
        └─► "Закрыть регистрацию" → registration_closed
              └─► "Начать турнир" → (подтверждение)
                    └─► Запуск: назначение seeds → генерация сетки
                                → создание матчей → in_progress
                          └─► По завершении финала → completed
```

При запуске турнира:
1. Случайно назначаются seeds участникам
2. `bracketGenerator` строит структуру матчей
3. Матчи создаются в БД с привязкой nextMatchId
4. Участникам отправляются уведомления о назначенных матчах

Удалить можно только турниры со статусом `draft` или `cancelled` (каскадное удаление в БД).

### 4. Регистрация участника

```
/tournaments → выбор турнира → карточка
  ├─► [Участвовать] → проверки → запись в tournamentParticipants
  └─► [Отменить регистрацию]
```

Проверки при регистрации:
1. Статус турнира = `registration_open`
2. Пользователь не зарегистрирован
3. Есть свободные места (< maxParticipants)

### 5. Проведение матча

```
/my_match → карточка матча
  └─► [Начать матч] → status: in_progress
        └─► [Внести результат] → выбор счёта
              └─► status: pending_confirmation
                    ├─► Уведомление сопернику
                    ├─► [Подтвердить] → status: completed → advanceWinner()
                    └─► [Оспорить] → status: in_progress (сброс результата)
```

Валидация счёта: один из счётов должен равняться winScore турнира, оба одновременно = winScore невозможно.

### 6. Технический результат (Администратор/Судья)

Доступно из карточки матча для администраторов. Администратор выбирает победителя и причину (`walkover` / `no_show` / `forfeit`). Счёт устанавливается как winScore:0, флаг `isTechnicalResult = true`. Матч завершается без двухфазного подтверждения.

### 7. Завершение турнира

При подтверждении финального матча (nextMatchId = null) автоматически вызывается `completeTournament()`. Статус → `completed`. Все участники получают уведомления о результате.

### 8. Управление ролями (Администратор)

- `/set_admin @username` — назначить администратора
- `/remove_admin @username` — снять администратора (нельзя снять себя)
- `/assign_referee {tournament_id} @username` — назначить судью турнира
- `/remove_referee {tournament_id} @username` — снять судью

Судья турнира может устанавливать технические результаты.

---

## API и команды бота

### Команды для пользователей

| Команда | Описание |
|---------|----------|
| `/start` | Регистрация / приветствие |
| `/tournaments` | Список всех турниров |
| `/my_tournaments` | Мои турниры |
| `/my_match` | Текущий активный матч |
| `/bracket` | Турнирная сетка |

### Команды для администраторов

| Команда | Описание |
|---------|----------|
| `/create_tournament` | Создать турнир (wizard) |
| `/delete_tournament` | Удалить турнир (draft/cancelled) |
| `/set_admin` | Назначить администратора |
| `/remove_admin` | Снять администратора |
| `/assign_referee` | Назначить судью турнира |
| `/remove_referee` | Снять судью турнира |

### Callback Query паттерны

#### Регистрация
- `reg:join:{tournamentId}` — зарегистрироваться
- `reg:cancel:{tournamentId}` — отменить регистрацию
- `reg:view:{tournamentId}` — просмотр турнира
- `reg:full:{tournamentId}` — заглушка (мест нет)

#### Управление турниром
- `tournament_info:{id}` — информация
- `tournament_open_reg:{id}` — открыть регистрацию
- `tournament_close_reg:{id}` — закрыть регистрацию
- `tournament_start:{id}` — показать подтверждение запуска
- `tournament_start_confirm:{id}` — запустить
- `tournament_delete_confirm:{id}` — показать подтверждение удаления
- `tournament_delete:{id}` — удалить
- `tournament_delete_cancel` — отмена

#### Wizard создания
- `discipline:{value}`, `format:{value}`, `participants:{n}`, `winscore:{n}`

#### Матчи
- `match:view:{id}` — просмотр
- `match:start:{id}` — начать
- `match:report:{id}` — форма результата
- `match:score:{id}:{p1}:{p2}` — выбор счёта
- `match:confirm:{id}` — подтвердить
- `match:dispute:{id}` — оспорить
- `match:tech:{id}` — меню тех. результата
- `match:tech_win:{id}:{winnerId}:{reason}` — установить тех. результат

#### Сетка
- `bracket:view:{tournamentId}` — просмотр сетки

---

## Бизнес-логика

### tournamentService

- `canStartTournament(id)` — проверка статуса + минимум 2 участника
- `getConfirmedParticipants(id)` — участники со статусом pending/confirmed
- `assignRandomSeeds(id)` — перемешивание и назначение порядковых номеров
- `startTournament(id)` — статус → in_progress
- `completeTournament(id, winnerId)` — статус → completed
- `updateTournamentStatus(id, status)` — прямое обновление статуса
- `deleteTournament(id)` — удаление (только draft/cancelled)

### matchService

- `createMatches(tournamentId, bracket)` — двухэтапное создание (сначала матчи, потом связи nextMatchId)
- `getMatch(id)` — матч с данными об игроках (JOIN users)
- `getPlayerCurrentMatch(tournamentId, userId)` — текущий матч игрока
- `getPlayerActiveMatches(userId)` — активные матчи во всех турнирах
- `startMatch(id)` — scheduled → in_progress, установка startedAt
- `reportResult(id, reporterId, p1Score, p2Score)` — внесение результата, определение победителя, статус → pending_confirmation
- `confirmResult(id, confirmerId)` — подтверждение соперником, completed, вызов advanceWinner()
- `disputeResult(id, userId)` — оспаривание, сброс результата, in_progress
- `setTechnicalResult(id, winnerId, reason, setById)` — тех. результат, вызов advanceWinner()
- `advanceWinner(id)` — продвижение победителя в следующий матч:
  - position нечётная → player1Id следующего матча
  - position чётная → player2Id следующего матча
  - nextMatchId = null → турнир завершён
- `checkTournamentCompletion(tournamentId)` — для разных форматов проверяет завершённость
- `getMatchStats(tournamentId)` — статистика (всего/завершено/в процессе/запланировано)

### tournamentStartService

Оркестрирует запуск турнира, избегая циклических зависимостей между matchService и tournamentService:
1. Назначение seeds
2. Генерация сетки через bracketGenerator
3. Создание матчей
4. Смена статуса на in_progress
5. Отправка уведомлений участникам

### bracketGenerator

- `generateBracket(format, participants)` — генерирует массив `BracketMatch[]`
- `getBracketStats(format, count)` — количество матчей и раундов
- `getRoundName(round, totalRounds, format, bracketType)` — название раунда (Финал, Полуфинал, Гранд-финал и т.д.)

**Алгоритм single_elimination:**
1. Размер сетки — ближайшая степень двойки к числу участников
2. Топ сиды (1, 2) получают Bye если участников меньше степени двойки
3. Расстановка: #1 vs #N, #(N/2) vs #(N/2+1), #2 vs #(N-1), ...
4. Формируются связи nextMatchId между матчами

### notificationService

Реализован. Отправляет уведомления через `bot.api.sendMessage`, сохраняет записи в таблицу `notifications`.

Покрытые события:
- Назначен матч (`notifyMatchAssigned`)
- Матч начат (`notifyMatchStart`)
- Результат ожидает подтверждения (`notifyResultPending`)
- Результат подтверждён (`notifyResultConfirmed`)
- Результат оспорен (`notifyResultDisputed`)
- Турнир завершён (`notifyTournamentCompleted`)
- Дисквалификация (`notifyDisqualification`)
- Напоминание о матче (`sendMatchReminder`)

### tableService

Управление физическими бильярдными столами:
- `getTables()`, `getTable(id)`, `createTable(name)`, `deleteTable(id)`
- `getTournamentTables(tournamentId)` — столы, привязанные к турниру
- `setTournamentTables(tournamentId, tableIds)` — задать список столов для турнира (транзакция)

### Middleware и Guards

**authMiddleware** — для каждого входящего сообщения:
1. Поиск пользователя в БД по telegram_id
2. Если не найден — создаётся с ролью `user`
3. Обновление username
4. Добавление `ctx.dbUser` в контекст Grammy

**adminOnly()** — блокирует доступ к команде для пользователей без роли `admin`.

### Статусы турнира

```
draft → registration_open → registration_closed → in_progress → completed
  └──────────────────────────────────────────────────────────→ cancelled
```

### Статусы матча

```
scheduled → in_progress → pending_confirmation → completed
                ↑               │
                └── dispute ────┘
```

### Двухфазное подтверждение результатов

1. **Репорт**: один игрок вносит счёт → `pending_confirmation`, `reportedBy` заполняется
2. **Подтверждение**: соперник подтверждает → `completed`, `confirmedBy` заполняется, вызывается `advanceWinner()`
3. **Оспаривание**: соперник отклоняет → `in_progress`, результат сбрасывается, требуется судья

---

## Админ-панель

### Аутентификация

Двухэтапная по Telegram-username:

1. Администратор вводит свой @username на странице входа
2. Сервер ищет пользователя в БД, проверяет роль `admin`, отправляет 6-значный код через бота
3. Администратор вводит код → сервер выдаёт JWT как httpOnly-cookie (`admin_token`, TTL 24 ч)

Дополнительно: одноразовые URL-токены (`loginTokens`) — вход по ссылке из Telegram.

Защита: максимум 5 попыток ввода кода, TTL кода 5 минут.

### API-маршруты (Hono)

Все `/api/*`-маршруты кроме `/api/auth/*` и `/api/health` защищены JWT-middleware.

| Префикс | Описание |
|---------|----------|
| `GET /api/health` | Проверка работоспособности |
| `/api/auth/*` | Вход, выход, проверка сессии |
| `/api/tournaments/*` | CRUD турниров, управление участниками |
| `/api/matches/*` | Просмотр и управление матчами |
| `/api/users/*` | Список пользователей, изменение ролей |
| `/api/tables/*` | CRUD столов, привязка к турнирам |

### Страницы SPA

- **Dashboard** — сводная статистика
- **Tournaments** — список турниров, создание, управление жизненным циклом
- **Tournament Detail** — карточка турнира, участники, матчи, столы
- **Match Detail** — карточка матча, управление результатом
- **Users** — список пользователей, управление ролями
- **Tables** — управление физическими столами

### TypeScript-конфигурация

- Серверный код: `tsconfig.json`, `module=nodenext`, импорты с расширением `.js`
- Admin SPA: `admin/tsconfig.json`, `moduleResolution=bundler`, `lib=[dom,esnext]`
- Типы из серверного кода доступны в SPA через alias `@server/*` (только `import type`, без runtime-зависимости)

---

## Особенности реализации

- **Circular dependency**: `tournamentStartService` выделен отдельно, чтобы разорвать циклическую зависимость matchService ↔ tournamentService
- **Wizard state**: состояние мастера создания турнира хранится в памяти (Map). При перезапуске сервера незавершённые wizard-сессии теряются
- **Bot singleton**: `src/bot/instance.ts` экспортирует единственный экземпляр бота, чтобы admin-сервер и bot-handlers использовали один объект
- **Cascade delete**: при удалении турнира каскадно удаляются участники, матчи, судьи, привязки столов
