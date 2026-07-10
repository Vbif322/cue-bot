-- Runs once on a fresh volume (Postgres /docker-entrypoint-initdb.d).
-- Drizzle migrations create tables inside the `prod` schema but do not create
-- the schema itself, so a brand-new DB needs it to exist before `npm run db:migrate`.
CREATE SCHEMA IF NOT EXISTS prod;
