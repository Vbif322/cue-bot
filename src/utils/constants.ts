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
  double_elimination_random: 'Двойная элиминация (рандом)',
  round_robin: 'Круговая система',
};

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  registration_open: 'Регистрация открыта',
  registration_closed: 'Регистрация закрыта',
  in_progress: 'В процессе',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

export function formatDiscipline(discipline: string): string {
  return DISCIPLINE_LABELS[discipline] ?? discipline;
}

export function formatFormat(format: string): string {
  return (FORMAT_LABELS as Record<string, string>)[format] ?? format;
}

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
