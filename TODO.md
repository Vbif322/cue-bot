# TODO

Приоритеты по аудиту от 2026-06-12 (`audit/FINDINGS.md`, сводка —
`audit/stage-8-synthesis.md`)

## M2 — Виды бильярда и дисциплины

Разбивка [ROADMAP.md](ROADMAP.md) на задачи.

- **M2-1:** двухуровневая модель вид→дисциплина вместо плоского `discipline`: `disciplines`
  (`src/db/schema/tournaments.ts:57-64`) и `DISCIPLINE_LABELS` (`src/utils/constants.ts:1-6`)
  → новая колонка `sport` + пересобранный `discipline` per sport (снукер 15/10/6 красных; пул
  8/9/10; русский бильярд свободная/комбинированная/динамичная). Миграция Drizzle; разумные
  дефолты правил/`winScore` (`src/shared/tournament/tournamentOptions.ts:10`) под дисциплину.
- **M2-2:** двухуровневый выбор в визарде создания турнира — новый шаг `sport` перед
  `discipline` в `CREATION_STEPS` (`tournamentCreation.const.ts:1-18`), `buildSportKeyboard()` +
  отфильтрованная `buildDisciplineKeyboard(sport)` (`tournamentCreation.keyboards.ts:110-124`),
  `handleSportSelection`/обновлённый `handleDisciplineSelection`
  (`tournamentCreation.flow.ts:451-491`), рендер-шаги
  (`tournamentCreation.renderer.ts:37-38,208-235`), типы состояния (`tournamentCreation.d.ts`).
- **M2-3:** админ-SPA — выбор вида+дисциплины при создании/редактировании турнира; сейчас поле
  вообще не показывается на клиенте, а сервер хардкодит `discipline: 'snooker'`
  (`src/admin/server/routes/tournaments.ts:210`) — убрать хардкод, прокинуть значения через
  тело запроса.
- **M2-4:** все новые строки — на русском (лейблы по образцу `DISCIPLINE_LABELS`).

### Детальный счёт по фреймам и статистика

- **M2-5:** таблица `match_frames` (`matchId` → `frameNumber`, очки игрока 1/2, победитель
  фрейма выводится) + миграция; агрегаты `player1Score`/`player2Score`
  (`src/db/schema/matches.ts:61-62`) пересчитываются из фреймов.
- **M2-6:** захват максимального брейка (снукер) — отдельное поле поверх очков фреймов.
- **M2-7:** ввод результата по фреймам в боте взамен выбора готового счёта — заменить текущий
  колбэк-флоу `match:report`/`match:score` (`src/bot/handlers/matchCommands.ts:401-512`,
  `reportResult` в `src/services/matchService.ts:438-486`) на ввод по фреймам; двухфазное
  подтверждение (`confirmResult`, `matchService.ts:491-538`) сохраняется — оппонент подтверждает
  разбивку по фреймам.
- **M2-8:** тай-брейк «группа + плей-офф» — настоящая разница очков вместо выведенной
  `frameDiff` (`src/services/standingsService.ts`, накопление `framesWon/framesLost` и финальный
  `frameDiff` строки ~106-166) — считать из `match_frames`.
- **M2-9:** админ-SPA — разбивка по фреймам и макс. брейк на вкладках матчей/standings.
- **M2-10:** детальное хранение очков — опционально, управляется дисциплиной (для дисциплин без
  «брейка» — только счёт фреймов).
- **M2-11:** переменная длина матча по раундам/этапам — `winScore`
  (`src/db/schema/tournaments.ts:107-110`) перестаёт быть единым на турнир, переопределение по
  раунду/стадии в схеме, выбор в визарде и админ-SPA; валидация в `reportResult`
  (`matchService.ts:459-468`) сверяет счёт с `winScore` нужного раунда, а не турнирным.

## M3 — Бот в групповом чате: анонсы и уведомления

Разбивка [ROADMAP.md](ROADMAP.md) на задачи. Контекст: `privateOnly()`
(`src/bot/guards.ts:18-28`) существует, но не подключён нигде (0 использований) — сейчас
ограничение на приватные чаты не в коде.

- **M3-1:** колонка `tournaments.groupChatId` (bigint — id супергрупп выходят за диапазон
  int32, вида `-100...`) + миграция; сейчас такой колонки нет.
- **M3-2:** флоу привязки группового чата к турниру (например, детект `my_chat_member` в группе
  или команда организатора внутри группы), пишущий `groupChatId`; авторизация — только
  организатор турнира.
- **M3-3:** новый seam отправки в группу — `postToGroupChat(api, chatId, text, keyboard?)`, по
  аналогии с `sendNotification` (`src/services/notificationService.ts:125-169`), но без записи в
  `notifications` (там `userId` `NOT NULL`, под группу не годится) — тот же
  `api.sendMessage`/Markdown-паттерн.
- **M3-4:** точки вызова — переиспользовать существующие чистые UI-билдеры:
  `buildTournamentMessage` (`src/bot/ui/tournamentUI.ts:110-134`) на анонс/расписание,
  `formatMatchCard` (`src/bot/ui/matchUI.ts:106+`) на результаты матчей, `buildBracketView`
  (`src/bot/ui/bracketUI.ts:118+`) на финальную сетку; вызывать на событиях
  создание/публикация турнира, завершение матча, завершение турнира. Read-only, без мутаций
  состояния из группы.
- **M3-5:** guard-ы/скоупы команд для групп — точечно подключить `privateOnly()`
  (`guards.ts:18`) к мутирующим командам; per-tournament scope команд
  (`{ type: 'chat', chat_id: groupChatId }`) вместо одинакового `all_group_chats`/
  `all_private_chats` (`src/bot/commands.ts:35-42`), по аналогии с per-user scope в
  `roleCommands.ts`.
- **M3-6:** управление рассылкой по-прежнему в личке/вебе — группа только на приём.

## P2 — Техдолг / UX (Low)

### Мелочь (по желанию, дёшево)

- **S5-5:** `tournaments.confirmedParticipants` — снапшот на `registration_closed`
  (`tournamentService.ts:889-896`), но читается для размера сетки (`matchService.ts:45`,
  `matchUI.ts:125`). Вероятно осознанно — задокументировать инвариант в схеме, а не менять.
