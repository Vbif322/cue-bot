// Презентационные хелперы: аватары-инициалы, имена, даты, подписи форматов.
import type { TournamentFormat, Discipline } from './types.ts';

/** Градиенты аватаров (из макетов Claude Design). */
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#3b82f6,#8b5cf6)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#10b981,#3b82f6)',
  'linear-gradient(135deg,#8b5cf6,#ec4899)',
  'linear-gradient(135deg,#06b6d4,#6366f1)',
  'linear-gradient(135deg,#f43f5e,#f59e0b)',
];

/** Детерминированный градиент по id/строке (стабильная раскраска аватаров). */
export function gradientFor(key: string | null | undefined): string {
  const s = key ?? '';
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]!;
}

interface NameParts {
  name?: string | null;
  surname?: string | null;
  username?: string | null;
}

/** Отображаемое имя игрока: имя (+фамилия) → @username → «Игрок». */
export function displayName(p: NameParts | null | undefined): string {
  if (!p) return 'Игрок';
  const full = [p.name, p.surname].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (p.username) return `@${p.username}`;
  return 'Игрок';
}

/** Инициалы (1–2 буквы) для аватара. */
export function initials(p: NameParts | null | undefined): string {
  if (!p) return '?';
  if (p.name) {
    const first = p.name.trim()[0] ?? '';
    const second = p.surname?.trim()[0] ?? p.name.trim().split(/\s+/)[1]?.[0] ?? '';
    return (first + second).toUpperCase() || '?';
  }
  if (p.username) return p.username.slice(0, 2).toUpperCase();
  return '?';
}

const DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});
const DATE_ONLY_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** Дата со временем: «12 апреля, 18:00» (UTC — как хранит бот). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return DATE_FMT.format(d).replace(/ г\.?$/, '');
}

/** Только дата: «12 апреля». */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return DATE_ONLY_FMT.format(d);
}

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  snooker: 'Снукер',
};

export function disciplineLabel(discipline: string): string {
  return DISCIPLINE_LABELS[discipline as Discipline] ?? discipline;
}

export const FORMAT_LABELS: Record<TournamentFormat, string> = {
  single_elimination: 'Плей-офф, на выбывание',
  double_elimination: 'Двойное выбывание',
  round_robin: 'Круговая (каждый с каждым)',
  groups_playoff: 'Группы + плей-офф',
};

export function formatLabel(format: string): string {
  return FORMAT_LABELS[format as TournamentFormat] ?? format;
}

/** Форматы, у которых сетка — дерево на выбывание. */
export function isEliminationFormat(format: string): boolean {
  return format === 'single_elimination' || format === 'double_elimination';
}

/** Латинская буква группы: 0 → A. */
export function groupLetter(index: number): string {
  return index >= 0 && index < 26 ? String.fromCharCode(65 + index) : `#${index + 1}`;
}

/**
 * Подпись раунда плей-офф от конца сетки: последний — «Финал», предпоследний —
 * «Полуфинал», далее «1/4 финала», «1/8 финала», иначе «Раунд N».
 */
export function roundLabel(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round; // 0 = финал
  if (fromEnd <= 0) return 'Финал';
  if (fromEnd === 1) return 'Полуфинал';
  const size = Math.pow(2, fromEnd);
  return `1/${size} финала`;
}

/** «X / max» участников. */
export function participantsLabel(confirmed: number, max: number): string {
  return `${confirmed} / ${max}`;
}

/** Процент заполнения (0–100). */
export function fillPercent(confirmed: number, max: number): number {
  if (!max) return 0;
  return Math.round(Math.max(0, Math.min(1, confirmed / max)) * 100);
}
