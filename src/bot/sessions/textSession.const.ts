const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * TTL текстовых сессий по флоу. Каждая запись (`update`) продлевает срок, так
 * что TTL — это «сколько ждём следующего шага», а не длительность всего флоу.
 * Брошенный промпт не должен днями перехватывать текст пользователя.
 */
export const TEXT_SESSION_TTL_MS = {
  tournamentCreation: 24 * HOUR_MS,
  profileEdit: HOUR_MS,
  invite: 30 * MINUTE_MS,
  matchSchedule: 30 * MINUTE_MS,
  matchFrames: 3 * HOUR_MS,
} as const;
