# TODO

Приоритеты по аудиту от 2026-06-12 (`audit/FINDINGS.md`, сводка —
`audit/stage-8-synthesis.md`)

## P2 — Техдолг / UX (Low)

### Мелочь (по желанию, дёшево)

- **S3-7:** вынести границы DE-участников `8/128` в общий константный модуль (сейчас magic
  numbers в `bracketGenerator.ts:252-254` и `tournamentService.ts:359-362`).
- **S5-5:** `tournaments.confirmedParticipants` — снапшот на `registration_closed`
  (`tournamentService.ts:889-896`), но читается для размера сетки (`matchService.ts:45`,
  `matchUI.ts:125`). Вероятно осознанно — задокументировать инвариант в схеме, а не менять.
