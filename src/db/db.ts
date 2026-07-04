import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL environment variable is not set. ' +
      'Please add DATABASE_URL to your .env file',
  );
}

// Explicit pool so we can attach an 'error' handler: node-postgres emits 'error'
// on idle clients (e.g. the DB drops a connection), and without a listener that
// becomes an unhandled 'error' event that can crash the process (S1-7). This is
// also the single place to tune pool sizing/timeouts later.
const pool = new Pool({ connectionString: DATABASE_URL });
pool.on('error', (err) => {
  console.error('Неожиданная ошибка idle-клиента пула БД:', err);
});

export const db = drizzle(pool, {
  schema,
});

/** A drizzle executor — either the root `db` or an open transaction handle. */
export type Executor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];
