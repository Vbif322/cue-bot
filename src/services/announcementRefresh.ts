import type { UUID } from 'crypto';

import { errorMessage } from '@/utils/errors.js';

/**
 * Отложенное обновление анонсов турнира в групповых чатах (ROADMAP M7, этап 2).
 *
 * Сервисы, меняющие то, что видно в анонсе (участники, статус, поля карточки),
 * зовут `markAnnouncementStale` — и всё. Здесь нет ни Api бота, ни БД: модуль
 * намеренно без зависимостей от сервисов, чтобы `tournamentService` мог импортировать его
 * без цикла через `groupBroadcastService`. Саму правку подставляет `src/index.ts`
 * через `setAnnouncementRefresher`. Пока она не подставлена (юнит-тесты, скрипты),
 * сигнал — no-op: ни таймеров, ни запросов.
 *
 * Сигналы по турниру склеиваются за `REFRESH_DEBOUNCE_MS`: пачка регистраций
 * даёт одну правку, а не десяток, и не упирается в ~20 сообщений/мин на группу.
 *
 * Состояние в памяти: таймеры теряются при рестарте. Следующее изменение всё
 * равно перерисует карточку целиком, поэтому худший исход — временно
 * устаревший счётчик.
 */

export const REFRESH_DEBOUNCE_MS = 5_000;

/** Что вернула правка. `retryAfterSec` — Telegram ответил 429. */
export interface RefreshOutcome {
  retryAfterSec?: number;
}

export type AnnouncementRefresher = (
  tournamentId: UUID,
) => Promise<RefreshOutcome>;

let refresher: AnnouncementRefresher | null = null;
const timers = new Map<UUID, NodeJS.Timeout>();
/** Турниры, чья правка идёт прямо сейчас. */
const running = new Set<UUID>();
/** Сигнал пришёл во время правки — после неё нужен ещё один проход. */
const dirty = new Set<UUID>();

/**
 * Подставить (или снять, `null`) функцию правки. Снятие гасит отложенные
 * таймеры — нужно тестам и на случай остановки бота.
 */
export function setAnnouncementRefresher(
  fn: AnnouncementRefresher | null,
): void {
  refresher = fn;
  if (fn === null) {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    dirty.clear();
  }
}

/**
 * Анонс турнира устарел — перерисовать его в группах. Звать ПОСЛЕ коммита
 * мутации: правка читает состояние из БД, а не из сигнала.
 */
export function markAnnouncementStale(tournamentId: UUID): void {
  if (refresher === null) return;

  // Правка уже идёт и могла прочитать БД до этого изменения. Таймер сейчас не
  // ставим, иначе два прохода шли бы параллельно и более старый мог закончить
  // последним, затерев свежий счётчик.
  if (running.has(tournamentId)) {
    dirty.add(tournamentId);
    return;
  }

  schedule(tournamentId, REFRESH_DEBOUNCE_MS);
}

function schedule(tournamentId: UUID, delayMs: number): void {
  const existing = timers.get(tournamentId);
  if (existing !== undefined) clearTimeout(existing);

  const timer = setTimeout(() => {
    void run(tournamentId);
  }, delayMs);
  timer.unref();
  timers.set(tournamentId, timer);
}

async function run(tournamentId: UUID): Promise<void> {
  timers.delete(tournamentId);
  const fn = refresher;
  if (fn === null) return;

  running.add(tournamentId);
  let outcome: RefreshOutcome = {};
  try {
    outcome = await fn(tournamentId);
  } catch (error) {
    // Контракт правки — не бросать; это страховка, чтобы `running` не залип.
    console.error(
      `Не удалось обновить анонс турнира ${tournamentId}:`,
      errorMessage(error),
    );
  } finally {
    running.delete(tournamentId);
  }

  if (outcome.retryAfterSec !== undefined) {
    // Telegram сам сказал, когда можно снова. Свежие сигналы покрываются этим
    // же проходом — он перечитает БД.
    dirty.delete(tournamentId);
    schedule(
      tournamentId,
      Math.max(outcome.retryAfterSec * 1000, REFRESH_DEBOUNCE_MS),
    );
    return;
  }

  if (dirty.delete(tournamentId)) {
    schedule(tournamentId, REFRESH_DEBOUNCE_MS);
  }
}
