// Single source of truth for the discrete tournament option values.
// Imported by the Drizzle schema (server) and the React SPA (via @server alias).
// Keep this file dependency-free so it stays safe to bundle into the client.

export const maxParticipants = [8, 16, 32, 64, 128] as const;

export type ITournamentMaxParticipants = (typeof maxParticipants)[number];

export const winScores = [2, 3, 4, 5] as const;

export type ITournamentWinScore = (typeof winScores)[number];
