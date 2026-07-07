import {
  check,
  pgSchema,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const createdAt = timestamp('created_at').notNull().defaultNow();
export const updatedAt = timestamp('updated_at')
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const prodSchema = pgSchema('prod');

/**
 * DB-level CHECK constraint pinning an enum-like varchar column to a fixed set of
 * values. Reuses the same `as const` arrays the columns derive their TS types from,
 * so the database and the type stay in sync. NULL passes (NULL IN (...) is unknown),
 * so nullable columns need no special handling.
 */
export function enumCheck(
  name: string,
  column: AnyPgColumn,
  values: readonly string[],
) {
  // Inline the values as literals via sql.raw: drizzle-kit serializes bound `sql`
  // params as `$1, $2, ...` placeholders, which are invalid in a CHECK constraint
  // DDL. The column reference still goes through the template so it renders fully
  // schema-qualified.
  const list = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
  return check(name, sql`${column} IN (${sql.raw(list)})`);
}

/**
 * DB-level CHECK constraint enforcing a numeric column is non-negative (>= 0).
 * NULL passes (NULL >= 0 is unknown), so nullable columns need no special handling.
 * The `0` is a literal in the static template, not a `${...}` param, so it is not
 * serialized as a `$1` placeholder (the pitfall enumCheck guards against).
 */
export function nonNegativeCheck(name: string, column: AnyPgColumn) {
  return check(name, sql`${column} >= 0`);
}
