export const DISCIPLINE_LABELS: Record<string, string> = {
  // pool: "Пул",
  snooker: 'Снукер',
  // russian_billiards: "Русский бильярд",
  // carom: "Карамболь",
};

export const FORMAT_LABELS: Record<string, string> = {
  single_elimination: 'Олимпийская система',
  double_elimination: 'Двойная элиминация',
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
  return FORMAT_LABELS[format] ?? format;
}

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
