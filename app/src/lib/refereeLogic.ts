// Чистая логика судейского пульта: состояние матча, очередь на столы, причины
// блокировки, подписи. Порт правил из admin QueueTab — держать в синхроне с
// сервером (getNextReadyMatch / onTableFreed / findBusyPlayerIds).
import type { AppMatch, RefereeBoard, TournamentFormat } from './types.ts';
import { displayName, groupLetter, roundLabel } from './format.ts';

/** Статусы, в которых матч ещё можно решать (и он держит свой стол). */
export const ACTIVE_STATUSES = new Set<AppMatch['status']>([
  'scheduled',
  'in_progress',
  'pending_confirmation',
]);

export const isActive = (m: AppMatch): boolean => ACTIVE_STATUSES.has(m.status);

/** Игроки вызваны к столу и ещё не оба подтвердили явку. */
export const isCalled = (m: AppMatch): boolean =>
  m.status === 'scheduled' && m.tableId !== null && m.calledAt !== null;

/** Ждёт стол: запланирован, стола нет. */
export const isWaiting = (m: AppMatch): boolean =>
  m.status === 'scheduled' && m.tableId === null;

export const hasBothPlayers = (m: AppMatch): boolean =>
  m.player1Id !== null && m.player2Id !== null;

/** Порядок очереди как на сервере: заданный судьёй, затем по сетке. */
export const byQueueOrder = (a: AppMatch, b: AppMatch): number =>
  (a.queueOrder ?? Infinity) - (b.queueOrder ?? Infinity) ||
  a.round - b.round ||
  a.position - b.position;

export function slotName(m: AppMatch, slot: 1 | 2): string {
  const id = slot === 1 ? m.player1Id : m.player2Id;
  const walkover = slot === 1 ? m.player1IsWalkover : m.player2IsWalkover;
  if (walkover) return 'Проходит';
  if (!id) return 'Ожидается';
  return slot === 1
    ? displayName({
        name: m.player1Name,
        surname: m.player1Surname,
        username: m.player1Username,
      })
    : displayName({
        name: m.player2Name,
        surname: m.player2Surname,
        username: m.player2Username,
      });
}

/** Имя игрока матча по его id (для «кто оспорил», «кто внёс»). */
export function nameById(m: AppMatch, userId: string | null): string | null {
  if (!userId) return null;
  if (userId === m.player1Id) return slotName(m, 1);
  if (userId === m.player2Id) return slotName(m, 2);
  return null;
}

/** Кто оспорил: игрок по имени, иначе администратор (спор из админки). */
export function disputerName(m: AppMatch): string | null {
  if (!m.disputedBy) return null;
  return nameById(m, m.disputedBy) ?? 'Администратор';
}

export function scoreText(m: AppMatch): string {
  return m.player1Score != null && m.player2Score != null
    ? `${m.player1Score}:${m.player2Score}`
    : '—';
}

/**
 * Подпись стадии матча: группа/тур, раунд плей-офф, нижняя сетка. Без
 * `maxWinnersRound` (вся сетка неизвестна) — просто «Раунд N».
 */
export function matchStageLabel(
  m: AppMatch,
  format: TournamentFormat,
  maxWinnersRound: number | null,
): string {
  if (m.phase === 'group') {
    return `Группа ${groupLetter(m.groupIndex ?? 0)} · Тур ${m.round}`;
  }
  if (format === 'round_robin') return `Тур ${m.round}`;
  if (m.bracketType === 'grand_final') return 'Гранд-финал';
  if (m.bracketType === 'losers') return `Нижняя сетка · раунд ${m.round}`;
  if (maxWinnersRound === null) return `Раунд ${m.round}`;
  return roundLabel(m.round, maxWinnersRound);
}

/** Последний раунд верхней сетки плей-офф (для «Финал/Полуфинал»). */
export function maxWinnersRound(matches: AppMatch[]): number {
  return Math.max(
    0,
    ...matches
      .filter(
        (m) =>
          m.phase === 'playoff' &&
          m.bracketType !== 'losers' &&
          m.bracketType !== 'grand_final',
      )
      .map((m) => m.round),
  );
}

/**
 * Минуты до дедлайна явки (≤ 0 — время вышло), null без дедлайна. `since` —
 * момент вызова: `now` тикает раз в 10–15 с и сразу после вызова бывает
 * раньше него, поэтому остаток не больше полной длины вызова (иначе «11 мин»
 * вместо 10).
 */
export function minutesLeft(
  deadline: string | null,
  now: number,
  since: string | null = null,
): number | null {
  if (!deadline) return null;
  const end = new Date(deadline).getTime();
  const ms = end - now;
  if (Number.isNaN(ms)) return null;
  const left = Math.ceil(ms / 60_000);
  const total = since
    ? Math.ceil((end - new Date(since).getTime()) / 60_000)
    : NaN;
  return Number.isNaN(total) ? left : Math.min(left, total);
}

export function callCountdown(m: AppMatch, now: number): string | null {
  const left = minutesLeft(m.callDeadlineAt, now, m.calledAt);
  if (left === null) return null;
  return left > 0 ? `осталось ${left} мин` : 'время на явку вышло';
}

export const isOverdue = (m: AppMatch, now: number): boolean =>
  isCalled(m) && (minutesLeft(m.callDeadlineAt, now) ?? 1) <= 0;

/**
 * Почему ожидающий матч нельзя посадить за стол прямо сейчас — по заметке на
 * занятого игрока: отсутствует, играет / вызван здесь, играет в другом турнире.
 */
export function makeBlockers(board: RefereeBoard): (m: AppMatch) => string[] {
  const absent = new Set(board.absent.map((p) => p.userId));
  const playing = new Set(
    board.matches
      .filter((m) => m.status === 'in_progress')
      .flatMap((m) => [m.player1Id, m.player2Id]),
  );
  const called = new Set(
    board.matches.filter(isCalled).flatMap((m) => [m.player1Id, m.player2Id]),
  );
  const elsewhere = new Map(
    board.busyElsewhere.map((b) => [b.userId, b.tournamentName]),
  );

  return (m) =>
    ([1, 2] as const).flatMap((slot) => {
      const id = slot === 1 ? m.player1Id : m.player2Id;
      if (id === null) return [];
      const name = slotName(m, slot);
      if (absent.has(id)) return [`${name} отсутствует`];
      if (playing.has(id)) return [`${name} играет`];
      if (called.has(id)) return [`${name} вызван к столу`];
      const other = elsewhere.get(id);
      return other === undefined ? [] : [`${name} играет в «${other}»`];
    });
}

/** Ожидающие стол матчи в порядке очереди. */
export function queueOf(board: RefereeBoard): AppMatch[] {
  return board.matches.filter(isWaiting).sort(byQueueOrder);
}

/** Незавершённый матч, который держит стол (null — стол свободен). */
export function holderOf(
  board: RefereeBoard,
  tableId: string,
): AppMatch | null {
  return board.matches.find((m) => m.tableId === tableId) ?? null;
}

/** Поставить элемент `from` на позицию `to` (новый массив id). */
export function moveId(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  if (id === undefined) return ids;
  next.splice(to, 0, id);
  return next;
}

// Время матчей — «настенное» UTC, как в боте и админке: 19:00 в форме хранится
// как 19:00 UTC и показывается игрокам как 19:00 (см. lib/format.ts).
const pad = (n: number): string => String(n).padStart(2, '0');

/** ISO → значение datetime-local по UTC-компонентам. */
export function isoToUtcInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Значение datetime-local → ISO UTC (null для пустого). */
export function utcInputToIso(input: string): string | null {
  if (!input) return null;
  const d = new Date(`${input}:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
