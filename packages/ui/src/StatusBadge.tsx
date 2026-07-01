import { Badge, type BadgeTone } from './Badge.tsx';

/**
 * Строковые union-типы статусов дублируют enum'ы БД (backend) специально:
 * пакет @cue-bot/ui — презентационный слой и не должен зависеть от бэкенда.
 * При изменении статусов в схеме — синхронизировать здесь.
 */
export type TournamentStatus =
  | 'draft'
  | 'registration_open'
  | 'registration_closed'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type MatchStatus =
  | 'scheduled'
  | 'in_progress'
  | 'pending_confirmation'
  | 'completed'
  | 'cancelled';

export type ParticipantStatus = 'pending' | 'confirmed' | 'cancelled';

const TOURNAMENT: Record<TournamentStatus, { label: string; tone: BadgeTone }> =
  {
    draft: { label: 'Черновик', tone: 'neutral' },
    registration_open: { label: 'Регистрация', tone: 'success' },
    registration_closed: { label: 'Рег. закрыта', tone: 'warning' },
    in_progress: { label: 'Идёт', tone: 'info' },
    completed: { label: 'Завершён', tone: 'accent' },
    cancelled: { label: 'Отменён', tone: 'danger' },
  };

const MATCH: Record<MatchStatus, { label: string; tone: BadgeTone }> = {
  scheduled: { label: 'Запланирован', tone: 'neutral' },
  in_progress: { label: 'Идёт', tone: 'info' },
  pending_confirmation: { label: 'Ожидает подтверждения', tone: 'warning' },
  completed: { label: 'Завершён', tone: 'success' },
  cancelled: { label: 'Отменён', tone: 'danger' },
};

const PARTICIPANT: Record<ParticipantStatus, { label: string; tone: BadgeTone }> =
  {
    pending: { label: 'Ожидает', tone: 'warning' },
    confirmed: { label: 'Подтверждён', tone: 'success' },
    cancelled: { label: 'Отменён', tone: 'muted' },
  };

export function TournamentStatusBadge({ status }: { status: TournamentStatus }) {
  const { label, tone } = TOURNAMENT[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function MatchStatusBadge({ status }: { status: MatchStatus }) {
  const { label, tone } = MATCH[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function ParticipantStatusBadge({ status }: { status: string }) {
  const known = PARTICIPANT[status as ParticipantStatus];
  if (!known) return <span className="text-xs text-gray-500">{status}</span>;
  return <Badge tone={known.tone}>{known.label}</Badge>;
}
