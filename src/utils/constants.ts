export const DISCIPLINE_LABELS: Record<string, string> = {
  // pool: "Пул",
  snooker: 'Снукер',
  // russian_billiards: "Русский бильярд",
  // carom: "Карамболь",
};

import type { ITournamentFormat } from '@/admin/server/formats.js';

export const FORMAT_LABELS: Record<ITournamentFormat, string> = {
  single_elimination: 'Олимпийская система',
  double_elimination: 'Двойная элиминация',
  round_robin: 'Круговая система',
  groups_playoff: 'Группа + плей-офф',
};

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  registration_open: 'Регистрация открыта',
  registration_closed: 'Регистрация закрыта',
  in_progress: 'В процессе',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

export const VISIBILITY_LABELS: Record<string, string> = {
  public: 'Открытый',
  private: 'Закрытый',
};

export const SCHEDULE_MODE_LABELS: Record<string, string> = {
  single_day: 'Один день',
  per_match: 'По матчам',
};

export function formatDiscipline(discipline: string): string {
  return DISCIPLINE_LABELS[discipline] ?? discipline;
}

export function formatFormat(format: string): string {
  return (FORMAT_LABELS as Record<string, string>)[format] ?? format;
}

/**
 * Format label with an optional "(рандом)" suffix when random pairing after each
 * round is enabled. `randomAdvancement` is orthogonal to the bracket format.
 */
export function formatFormatWithMode(
  format: string,
  randomAdvancement: boolean,
): string {
  const label = formatFormat(format);
  return randomAdvancement ? `${label} (рандом)` : label;
}

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatVisibility(visibility: string): string {
  return VISIBILITY_LABELS[visibility] ?? visibility;
}

export function formatScheduleMode(scheduleMode: string): string {
  return SCHEDULE_MODE_LABELS[scheduleMode] ?? scheduleMode;
}

/** Latin letter label for a 0-based group index (0 → A, 1 → B, …). */
export function groupLetter(index: number): string {
  return index >= 0 && index < 26
    ? String.fromCharCode(65 + index)
    : `#${String(index + 1)}`;
}
