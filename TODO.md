# TODO

Приоритеты по аудиту от 2026-06-12 (`audit/FINDINGS.md`, сводка —
`audit/stage-8-synthesis.md`)

## P2 — Техдолг / UX (Low)

Порядок групп по польза/цена: **2 → 4**. (Группа 6 — сделана.)

### Группа 2 — Дедупликация и N+1 в matchService (S3-5)

Всё в `src/services/matchService.ts`, без изменения поведения:

- Общий select+mapping `MatchWithPlayers` (дубль в `getMatch` :123-165 и `getTournamentMatches` :273-312).
- Устранить N+1: `getPlayerActiveMatches` (:201-228), `getPlayerCurrentMatch` (:171-196),
  `getPlayerMatchHistory` (:234-259) — зовут `getMatch` в цикле.
- Батчевая вставка в `createMatches` (:53-108) вместо `insert().returning()` в цикле.

### Группа 4 — Доменные CHECK-ограничения в БД (S5-4)

Enum-CHECK'и и партиал-уник на username уже есть (`schemaHelpers.ts:23-34`, `users.ts:30-32`);
осталось числовое:

- CHECK на неотрицательность `matches.player1Score/player2Score/round/position`
  (`schema/matches.ts:47-61`) и `tournaments.maxParticipants/winScore/…` (`tournaments.ts:102-118`).
- `npm run db:generate` → `db:migrate`..

### Мелочь (по желанию, дёшево)

- **S3-7:** вынести границы DE-участников `8/128` в общий константный модуль (сейчас magic
  numbers в `bracketGenerator.ts:252-254` и `tournamentService.ts:359-362`).
- **S5-5:** `tournaments.confirmedParticipants` — снапшот на `registration_closed`
  (`tournamentService.ts:889-896`), но читается для размера сетки (`matchService.ts:45`,
  `matchUI.ts:125`). Вероятно осознанно — задокументировать инвариант в схеме, а не менять.
