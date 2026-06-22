-- One-time prod hotfix: idempotently apply schema objects from migrations 0009-0013.
-- Cause: /drizzle was git-ignored, so `drizzle-kit generate` ran on the prod server during
-- deploy and silently failed to emit some ALTER TABLE ... ADD COLUMN -> errorMissingColumn flood.
-- Safe to re-run. Run as: psql "$DATABASE_URL" -f scripts/prod-hotfix-0009-0013.sql
SET search_path TO prod;

-- 0009
ALTER TABLE matches      ADD COLUMN IF NOT EXISTS losers_next_match_slot varchar(10);
ALTER TABLE tournaments  ADD COLUMN IF NOT EXISTS merge_round integer NOT NULL DEFAULT 2;

-- 0010
ALTER TABLE matches      ADD COLUMN IF NOT EXISTS phase varchar NOT NULL DEFAULT 'playoff';
ALTER TABLE matches      ADD COLUMN IF NOT EXISTS group_index integer;
ALTER TABLE tournaments  ADD COLUMN IF NOT EXISTS groups_count integer;
ALTER TABLE tournaments  ADD COLUMN IF NOT EXISTS participants_per_group integer;
ALTER TABLE tournaments  ADD COLUMN IF NOT EXISTS qualifiers_per_group integer;
ALTER TABLE tournaments  ADD COLUMN IF NOT EXISTS group_draw varchar;

-- 0011
CREATE TABLE IF NOT EXISTS dialog_sessions (
	"namespace" varchar(32) NOT NULL,
	"key" varchar(64) NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dialog_sessions_namespace_key_pk" PRIMARY KEY("namespace","key")
);

-- 0012
CREATE INDEX IF NOT EXISTS "matches_tournament_id_idx" ON matches USING btree ("tournament_id");
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx" ON notifications USING btree ("user_id","created_at") WHERE is_read = false;

-- 0013 CHECK constraints (ADD CONSTRAINT has no IF NOT EXISTS; guard each against re-run).
-- A constraint that fails to add because existing data violates it will raise loudly here
-- (NOT duplicate_object) -> that surfaces real bad data to clean up, by design.
DO $$ BEGIN
	ALTER TABLE matches ADD CONSTRAINT "matches_status_check" CHECK ("status" IN ('scheduled', 'in_progress', 'pending_confirmation', 'completed', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE matches ADD CONSTRAINT "matches_phase_check" CHECK ("phase" IN ('group', 'playoff'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE notifications ADD CONSTRAINT "notifications_type_check" CHECK ("type" IN ('registration_confirmed', 'registration_rejected', 'bracket_formed', 'match_reminder', 'result_confirmation_request', 'result_confirmed', 'tournament_results', 'new_registration', 'participant_limit_reached', 'result_dispute', 'match_result_pending', 'disqualification', 'tournament_invitation', 'tournament_cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE tournament_participants ADD CONSTRAINT "tournament_participants_status_check" CHECK ("status" IN ('pending', 'confirmed', 'cancelled', 'disqualified', 'invited'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE tournaments ADD CONSTRAINT "tournaments_discipline_check" CHECK ("discipline" IN ('snooker'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE tournaments ADD CONSTRAINT "tournaments_format_check" CHECK ("format" IN ('single_elimination', 'double_elimination', 'round_robin', 'groups_playoff'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE tournaments ADD CONSTRAINT "tournaments_status_check" CHECK ("status" IN ('draft', 'registration_open', 'registration_closed', 'in_progress', 'completed', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE tournaments ADD CONSTRAINT "tournaments_visibility_check" CHECK ("visibility" IN ('public', 'private'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE tournaments ADD CONSTRAINT "tournaments_schedule_mode_check" CHECK ("schedule_mode" IN ('single_day', 'per_match'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE tournaments ADD CONSTRAINT "tournaments_group_draw_check" CHECK ("group_draw" IN ('snake', 'random'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
	ALTER TABLE users ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('user', 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
