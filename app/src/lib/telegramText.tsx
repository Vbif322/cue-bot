// Текст уведомлений хранится в разметке Telegram (legacy Markdown, как его
// отправляет бот): *жирный*, _курсив_, `код`, [текст](url) и экранирование
// \_ \* \` \[. Здесь он превращается в React-узлы для сайта: tg://-ссылки
// (профили игроков) в браузере не открыть, поэтому от них остаётся только текст.
import type { ReactNode } from 'react';

const ESCAPABLE = new Set(['_', '*', '`', '[']);

/** Индекс следующего неэкранированного `ch` начиная с `from`, иначе -1. */
function findClose(text: string, ch: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\' && ESCAPABLE.has(text[i + 1] ?? '')) {
      i++;
      continue;
    }
    if (text[i] === ch) return i;
  }
  return -1;
}

const unescape = (s: string): string => s.replace(/\\([_*`[])/g, '$1');

const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url);

export function renderTelegramText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(buf);
    buf = '';
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '';
    const next = text[i + 1] ?? '';
    if (c === '\\' && ESCAPABLE.has(next)) {
      buf += next;
      i++;
      continue;
    }

    if (c === '*' || c === '_' || c === '`') {
      const end = findClose(text, c, i + 1);
      if (end > i + 1) {
        flush();
        const inner = text.slice(i + 1, end);
        out.push(
          c === '*' ? (
            <strong key={i}>{renderTelegramText(inner)}</strong>
          ) : c === '_' ? (
            <em key={i}>{renderTelegramText(inner)}</em>
          ) : (
            <code key={i}>{inner}</code>
          ),
        );
        i = end;
        continue;
      }
    }

    if (c === '[') {
      const close = findClose(text, ']', i + 1);
      const urlEnd =
        close !== -1 && text[close + 1] === '('
          ? text.indexOf(')', close + 2)
          : -1;
      if (urlEnd !== -1) {
        flush();
        const label = unescape(text.slice(i + 1, close));
        const url = text.slice(close + 2, urlEnd);
        out.push(
          isWebUrl(url) ? (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              // Карточка уведомления сама кликабельна — ссылка не должна её открывать.
              onClick={(e) => e.stopPropagation()}
            >
              {label}
            </a>
          ) : (
            label
          ),
        );
        i = urlEnd;
        continue;
      }
    }

    buf += c;
  }
  flush();
  return out;
}
