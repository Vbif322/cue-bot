import { Bot } from 'grammy';

import type { BotContext } from './types.js';

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is not set');
}

export const bot = new Bot<BotContext>(token);

// В production бот по умолчанию получает обновления через вебхук (Telegram пушит их на
// HTTP-эндпоинт), в dev — через long polling. Режим развязан от NODE_ENV флагом
// BOT_UPDATE_MODE: на площадках, где Telegram не может стабильно достучаться до нас входящим
// соединением (напр. RU-хостинг с фильтрацией Telegram по IPv4), ставим BOT_UPDATE_MODE=polling,
// и апдейты забираем сами исходящим запросом (по IPv6 путь работает). Флаг общий: по нему
// index.ts выбирает setWebhook/polling И останавливает бота, а admin/server монтирует
// вебхук-роут — иначе grammY `webhookCallback` подменяет `bot.start` заглушкой и polling падает.
export const useWebhook =
  process.env.NODE_ENV === 'production' &&
  process.env.BOT_UPDATE_MODE !== 'polling';
