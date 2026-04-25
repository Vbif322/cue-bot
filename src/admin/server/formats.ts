// Single source of truth for tournament format identifiers.
// Imported by the Drizzle schema (server) and the React SPA (via @server alias).
// Keep this file dependency-free so it stays safe to bundle into the client.

export const formats = [
  'single_elimination',
  'double_elimination',
  'double_elimination_random',
  'round_robin',
] as const;

export type ITournamentFormat = (typeof formats)[number];
