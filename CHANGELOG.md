# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added a per-stage match length (`stageWinScores`): a tournament may play its
  closing playoff matches longer than its baseline `winScore` (e.g. race to 3
  early, 4 in the semifinals, 5 in the final). Stages are keyed from the end of
  the bracket (`final` / `semifinal` / `quarterfinal`), so the setting keeps its
  meaning whatever the actual turnout. The effective length is resolved once at
  bracket generation into the new `matches.win_score` column and drives result
  reporting, per-frame entry, technical results and result corrections.
  Selectable in the Telegram wizard and the admin panel; applies to the playoff
  side only (group tours, round robin and the double-elimination losers bracket
  always use the tournament `winScore`).
- Added a configurable double-elimination "merge round" (`mergeRound`): tournaments
  choose after which upper-bracket round the losers bracket merges into a
  single-elimination playoff (default 2 = previous scheme, k = full double
  elimination). Selectable in the Telegram wizard and the admin panel.
- Added mandatory venue selection for tournament creation in both the Telegram wizard and the admin panel.
- Added optional table selection scoped to the selected venue during tournament draft creation.
- Added a modular tournament creation flow split into state store, renderer, keyboards, and orchestration modules.
- Added `DateTimeHelper` based on Luxon for parsing and formatting dates in multiple input formats.
- Added venue-aware read models that expose `venueName` for tournament UI and API consumers.
- Added venue service read models with `tablesCount` for admin management screens.

### Changed

- Changed the group-phase tiebreak to use the real points difference from
  `match_frames` (after frame difference, before frames won). It only applies when
  every completed non-walkover match of the group has a frame breakdown; otherwise
  standings behave exactly as before. The points column is shown in the bot, the
  admin panel and the player web app under the same condition.
- Changed double-elimination bracket generation to be size-generalized (8–128
  participants, true bracket sizing instead of a fixed 16-slot layout) and to store
  the losers-bracket drop slot on each match, so runtime advancement and correction
  rollback follow stored routing rather than a hardcoded formula.
- Changed tournament creation to go through `createTournamentDraft()` with transactional validation of venue and table assignments.
- Changed the tournaments schema so every tournament must reference a venue.
- Changed table validation so only tables from the selected venue can be assigned to a tournament.
- Changed supported tournament configuration values to typed sets for `maxParticipants` and `winScore`.
- Changed bot and admin server code to use typed `UUID` identifiers across routes, services, and database schema definitions.
- Changed server imports to use the `@/*` path alias from the root TypeScript configuration.
- Changed tournament and registration UI messages to include venue information and the new date formatting helper.

### Removed

- Removed the legacy monolithic `src/bot/wizards/tournamentCreationWizard.ts` implementation.
- Removed the legacy `src/utils/dateHelpers.ts` helper in favor of the Luxon-based datetime module.
- Removed the dashboard route from the active admin SPA router.

### Fixed

- Fixed the participant count incorrectly showing zero on the tournaments list.
