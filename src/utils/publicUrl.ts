/**
 * Абсолютная ссылка на страницу сайта игрока (`app/`) или null, если ссылаться
 * некуда. Только https: Telegram принимает в `web_app` лишь https, а в кнопках
 * отвергает localhost; PUBLIC_BASE_URL в обычном dev не задан (его задаёт
 * https-туннель). Читается на каждый вызов, чтобы тесты могли подменить env.
 */
export function publicSiteUrl(path: string): string | null {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base?.startsWith('https://')) return null;
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
