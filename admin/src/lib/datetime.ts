// Match scheduling is shown/edited in UTC wall-clock, consistent with the bot
// (DateTimeHelper formats and parses match times in UTC). A time picked here as
// "19:00" is stored as 19:00 UTC and shown as 19:00 to players in the bot.

const pad = (n: number): string => String(n).padStart(2, '0');

/** ISO string → "DD.MM.YYYY HH:mm" in UTC (empty string for null). */
export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

/** ISO string → "YYYY-MM-DDTHH:mm" (UTC components) for a datetime-local input. */
export function isoToUtcInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** datetime-local value ("YYYY-MM-DDTHH:mm") → ISO UTC string (null if empty). */
export function utcInputToIso(input: string): string | null {
  if (!input) return null;
  return new Date(`${input}:00.000Z`).toISOString();
}
