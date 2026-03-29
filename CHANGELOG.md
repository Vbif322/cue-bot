# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added mandatory venue selection for tournament creation in both the Telegram wizard and the admin panel.
- Added optional table selection scoped to the selected venue during tournament draft creation.
- Added a modular tournament creation flow split into state store, renderer, keyboards, and orchestration modules.
- Added `DateTimeHelper` based on Luxon for parsing and formatting dates in multiple input formats.
- Added venue-aware read models that expose `venueName` for tournament UI and API consumers.
- Added venue service read models with `tablesCount` for admin management screens.

### Changed

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
