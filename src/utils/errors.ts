/**
 * Extract a human-readable, user-facing message from an unknown caught value.
 *
 * Use this in `catch (error)` blocks instead of `JSON.stringify(error)` — the
 * latter serialises an `Error` to `"{}"` (Error's own properties are
 * non-enumerable), leaving the user with an empty message. All strings are
 * user-facing, so the fallback is Russian.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Неизвестная ошибка';
}
