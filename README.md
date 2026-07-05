# Cue Bot

Telegram бот для автоматизации проведения турниров по бильярду.

## Описание

Cue Bot — это решение для организации и проведения турниров по бильярду через Telegram. Бот автоматизирует процесс регистрации участников, формирования турнирной сетки, ведения протоколов матчей и уведомления игроков.

## Возможности

### Для участников

- **Просмотр текущих турниров** — актуальный список доступных турниров с информацией о формате, датах и количестве участников
- **Регистрация на турнире** — простая процедура записи на участие в турнире
- **Просмотр сетки турнира** — визуализация турнирной сетки с результатами и расписанием
- **Уведомления о предстоящих матчах** — автоматические напоминания о начале игр
- **Внесение счета в протокол** — возможность добавить результат матча с обязательным подтверждением от соперника
- **Web App** — мини-приложение Telegram с интерактивной турнирной сеткой

### Для администраторов

- **Управление турнирами** — создание, редактирование и удаление турниров
- **Управление участниками** — добавление/удаление игроков, работа со списками участников
- **Ручная корректировка** — возможность внести любые изменения:
  - Редактирование счета
  - Дисквалификация участников
  - Технические поражения
  - Перенос матчей
  - Другие административные действия
- **Административная панель** — веб-интерфейс для управления ботом

## Технологии

- **Node.js** — серверная платформа
- **TypeScript** — язык разработки
- **Grammy** — фреймворк для Telegram ботов
- **Hono** — HTTP-сервер для API и раздачи статики
- **Drizzle ORM** — работа с базой данных
- **PostgreSQL** — база данных
- **React + Vite** — фронтенд: административная панель и Telegram Web App
- **Nodemon** — автоматическая перезагрузка при разработке

## Установка

1. Клонируйте репозиторий:

```bash
git clone https://github.com/Vbif322/cue-bot.git
cd cue-bot
```

2. Установите зависимости сервера:

```bash
npm install
```

3. Установите зависимости фронтенда:

```bash
cd admin && npm install && cd ..
```

4. Создайте файл `.env` в корне проекта на основе [`.env.example`](.env.example):

```env
BOT_TOKEN=your_telegram_bot_token_here
DATABASE_URL=postgresql://user:password@localhost:5432/cuebot
JWT_SECRET=your_jwt_secret_here
ADMIN_PORT=3000
NODE_ENV=development

# Вход через Telegram (OIDC) на сайте игрока — см. «Вход через Telegram»:
TELEGRAM_CLIENT_ID=your_oidc_client_id
TELEGRAM_CLIENT_SECRET=your_oidc_client_secret
# redirect_uri, зарегистрированный в BotFather. В dev — origin Vite:
TELEGRAM_REDIRECT_URI=http://localhost:5173/api/app/auth/telegram/callback
```

5. Получить токен можно у [@BotFather](https://t.me/botfather) в Telegram

`TELEGRAM_CLIENT_ID` / `TELEGRAM_CLIENT_SECRET` — выдаёт BotFather (Bot Settings →
Web Login). Наличие `TELEGRAM_CLIENT_ID` включает кнопку входа: публичный
`GET /api/app/config` отдаёт `telegramLoginEnabled`.

## Запуск

### Режим разработки

**Быстрый старт — одна команда поднимает весь стек:**

```bash
npm run dev:all
```

Скрипт автоматически:

1. Стартует Docker-контейнер `drizzle-postgres` в WSL и ждёт готовности Postgres (`pg_isready`).
2. Параллельно запускает в одном терминале с цветными префиксами:
   - `[api]` — бот + Hono API (порт **3000**)
   - `[web]` — Vite dev сервер для SPA (порт **5173**, проксирует `/api` на 3000)
   - `[db]` — Drizzle Studio (https://local.drizzle.studio)
   - `[login]` — синяя ссылка для входа в админку, печатается через пару секунд после старта
     `[web]` (см. [Вход в админку](#вход-в-админку-локально)); поток одноразовый и завершается сразу.

`Ctrl+C` корректно гасит процессы разом. Контейнер БД остаётся запущенным — повторный `npm run dev:all` стартует за секунды.

### Вход в админку (локально)

Веб-вход устроен через одноразовую ссылку: в проде её выдаёт команда бота `/dashboard` (нужен
HTTPS-домен). Локально это не работает — Telegram не делает localhost-ссылки кликабельными, а
WebApp-кнопки требуют HTTPS. Поэтому для разработки ссылка генерируется командой:

```bash
npm run dev:login                 # первый администратор в БД
npm run dev:login -- @username    # конкретный админ по username
npm run dev:login -- 123456789    # конкретный админ по telegram_id
```

Команда печатает готовую ссылку (`http://localhost:5173/api/auth/token?t=…`, действительна 30 минут) —
открой её в браузере, выставится cookie `admin_token` и откроется админка. `npm run dev:all`
вызывает её автоматически и показывает ссылку синим в потоке `[login]` сразу после старта `[web]`.

Базовый URL можно переопределить через `DEV_LOGIN_URL` (по умолчанию `http://localhost:5173`),
например `DEV_LOGIN_URL=http://localhost:3000 npm run dev:login`, если SPA раздаётся самим API.

> Если в БД ещё нет администратора, назначьте себя: напишите боту `/start`, узнайте свой
> `telegram_id`, затем `UPDATE prod.users SET role='admin' WHERE telegram_id='<ваш_id>';`
> (или `/set_admin <telegram_id>` с другого админского аккаунта).

**Предпосылки для `dev:all`:**

- Windows + WSL2 (Ubuntu) с Docker внутри WSL.
- Контейнер с именем `drizzle-postgres` уже создан.
- WSL-пользователь добавлен в группу `docker` (`sudo usermod -aG docker $USER` + перелогин), иначе скрипт упадёт на правах сокета.

**Отдельные команды (если нужно запустить что-то одно):**

```bash
npm run dev          # только бот + API
npm run dev:admin    # только Vite SPA
npm run db:studio    # только Drizzle Studio
npm run db:up        # поднять контейнер БД
npm run db:down      # остановить контейнер БД
npm run dev:login    # ссылка для входа в админку (см. ниже)
```

### Туннель для Telegram Web App

Для разработки Telegram Web App необходим публичный HTTPS-адрес. Используйте SSH-туннель для проброса локального Vite сервера на сервер:

```bash
ssh -N \
  -o "ServerAliveInterval 30" \
  -o "ServerAliveCountMax 3" \
  -R 8080:localhost:5173 \
  user@your-server
```

После этого Web App будет доступен по вашему публичному адресу (через nginx, проксирующий порт 8080). `allowedHosts` в `vite.config.ts` выставлен в `true`, поэтому туннель с любым доменом принимается.

### Вход через Telegram (OIDC)

На сайте игрока (`app/`) наряду с входом по коду на почту доступен вход через
Telegram по OpenID Connect (Authorization Code Flow + PKCE). Кнопка — обычная
ссылка на `GET /api/app/auth/telegram/start`; бэкенд уводит браузер на
`oauth.telegram.org`, обменивает `code` на `id_token` server-to-server и ставит
сессию. Привязка из профиля — тот же поток с `?link=1`.

Настройка у [@BotFather](https://t.me/botfather) → **Bot Settings → Web Login**:

1. Переключить бота на OpenID Connect Login → получить **Client ID** и
   **Client Secret** → положить в `TELEGRAM_CLIENT_ID` / `TELEGRAM_CLIENT_SECRET`.
2. В **Allowed URLs** добавить:
   - **Trusted Origins** (origin, без пути): прод — `https://<домен>`;
     dev — `http://localhost:5173`.
   - **Redirect URIs** (полный URL): прод —
     `https://<домен>/api/app/auth/telegram/callback`; dev —
     `http://localhost:5173/api/app/auth/telegram/callback` (Vite проксирует
     `/api` на `:3000`). Значение должно совпадать с `TELEGRAM_REDIRECT_URI`.

Подпись `id_token` не проверяется: токен приходит по прямому TLS-каналу с token
endpoint (OIDC Core §3.1.3.7), сверяются `iss`/`aud`/`exp`.

### Сборка проекта

Собрать фронтенд:

```bash
npm run build:admin
```

Собрать серверный код:

```bash
npm run build
```

В продакшене Hono раздаёт оба собранных SPA одним процессом, выбирая `dist` по
заголовку `Host`: админку (`admin/dist/`) — на админ-хосте (`ADMIN_BASE_URL`), сайт
игрока (`app/dist/`) — на публичном хосте (`PUBLIC_BASE_URL`). nginx для обоих
поддоменов делает простой `proxy_pass` на один и тот же `ADMIN_PORT` и **обязан**
пробрасывать исходный `Host` (`proxy_set_header Host $host`) — иначе Node всегда отдаст
SPA игрока. Готовый конфиг — в `deploy/nginx/` (см. раздел «nginx» ниже).

### Продакшен: вебхук Telegram

В продакшене (`NODE_ENV=production`) бот получает обновления через **вебхук**, а не long
polling. Дополнительно к базовым переменным задайте в `.env`:

```env
NODE_ENV=production
PUBLIC_BASE_URL=https://example.com          # публичный HTTPS-адрес деплоя (сайт игрока + вебхук)
ADMIN_BASE_URL=https://admin.example.com     # HTTPS-адрес админки (поддомен)
TELEGRAM_WEBHOOK_SECRET=<длинная_случайная_строка>
```

В продакшене `PUBLIC_BASE_URL` и `ADMIN_BASE_URL` **обязательны** (без них бот не настроит
вебхук / статику и сообщит об этом в лог). Подставьте свои реальные адреса.

`ADMIN_BASE_URL` задаёт хост админки: из него строится ссылка команды `/dashboard`,
по `new URL(ADMIN_BASE_URL).host` Node выбирает, какой SPA отдать (диспетчеризация по
`Host`), а старые кнопки «Открыть панель» из истории чатов (вели на `PUBLIC_BASE_URL`)
редиректятся сюда до погашения одноразового токена входа.

При старте бот сам вызывает `setWebhook` на
`https://<PUBLIC_BASE_URL>/api/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>`. Секрет также
проверяется по заголовку `X-Telegram-Bot-Api-Secret-Token` (грамматика grammY возвращает
`401` при несовпадении). Убедитесь, что nginx проксирует `/api/` на порт `ADMIN_PORT` —
отдельного правила для вебхука не требуется, он живёт под `/api/`.

Проверить: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`.

### Продакшен: nginx

Готовый конфиг лежит в `deploy/nginx/cuebot.conf` — два HTTPS-vhost-а (сайт игрока и
админка) проксируют на один и тот же `ADMIN_PORT`, а Node выбирает нужный SPA по
заголовку `Host`. Сам домен в репозитории не хранится: `server_name` и пути к
сертификатам вынесены в подключаемые сниппеты, которые вы создаёте на сервере из
образца `deploy/nginx/snippets/host.conf.example`.

```bash
# 1. Сертификаты (или один wildcard *.example.com + example.com)
sudo certbot --nginx -d example.com
sudo certbot --nginx -d admin.example.com

# 2. Сниппеты с реальными хостами (в git НЕ добавляются)
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/nginx/snippets/host.conf.example /etc/nginx/snippets/cuebot-player-host.conf
sudo cp deploy/nginx/snippets/host.conf.example /etc/nginx/snippets/cuebot-admin-host.conf
# отредактировать оба: server_name + пути к сертификатам под свои хосты

# 3. Подключить конфиг из репозитория симлинком и перезагрузить nginx
sudo ln -s "$(pwd)/deploy/nginx/cuebot.conf" /etc/nginx/sites-enabled/cuebot.conf
sudo nginx -t && sudo systemctl reload nginx
```

Ключевой момент — `proxy_set_header Host $host` в обоих `location /` (уже в конфиге):
без него Node не сможет отличить админ-хост от публичного и всегда отдаст SPA игрока.

## Структура проекта

```
cue-bot/
├── src/
│   ├── index.ts                  # Точка входа (бот + HTTP сервер)
│   ├── bot/                      # Логика бота (Grammy)
│   ├── db/                       # Drizzle ORM: схема и подключение
│   ├── services/                 # Бизнес-логика (турниры, матчи, уведомления)
│   └── admin/
│       └── server/               # Hono API: роуты, middleware, auth
├── admin/                        # React SPA (отдельный Vite проект)
│   ├── src/                      # Исходники фронтенда
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── package.json                  # Зависимости и скрипты сервера
├── tsconfig.json                 # Конфигурация TypeScript (сервер)
└── .env                          # Переменные окружения (не в git)
```

## Разработка

Проект использует TypeScript для типобезопасности и Nodemon для автоматической перезагрузки при изменении файлов в режиме разработки.

Типы API (`src/admin/server/apiTypes.ts`) используются совместно сервером и React-приложением через alias `@server/*` в конфигурации Vite и TypeScript.

## Лицензия

MIT

## Поддержка

Если у вас возникли проблемы или есть предложения по улучшению, создайте [issue](https://github.com/Vbif322/cue-bot/issues) в репозитории проекта.
