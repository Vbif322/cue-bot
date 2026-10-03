-- One-off data fix: move a player's participation in ONE completed tournament from an
-- admin-created placeholder account (admin "external" participant: no telegram_id/email/identity,
-- matches driven by the admin) to the real account the player registered later, so the
-- tournament shows up in the real player's stats / match history / leaderboard.
--
-- Stats are computed on read from matches / match_frames / tournament_participants, so nothing
-- needs recomputing. match_frames has no user columns (points belong to the match's
-- player1/player2 slot) and moves with the match. Data handling mirrors
-- mergeAccountIntoTelegram (src/services/userService.ts) but every change is scoped to the
-- tournament. Afterwards the placeholder is tombstoned (like anonymizeUser) only if nothing
-- references it anymore.
--
-- Dry run by default (ends with ROLLBACK, prints a report). Add -v commit=1 to persist:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 \
--     -v tournament_id=<uuid> -v old_user=<uuid> -v new_user=<uuid> \
--     [-v commit=1] -f scripts/prod-reassign-participant.sql
--
-- Back up first: pg_dump "$DB_URL" -n prod -Fc -f backup-$(date +%F).dump
--
-- Finding the ids (read-only):
--   SELECT id, name, status FROM prod.tournaments WHERE name ILIKE '%...%';
--   SELECT u.id, u.username, u.name, u.surname, u.telegram_id, u.email
--   FROM prod.tournament_participants tp JOIN prod.users u ON u.id = tp.user_id
--   WHERE tp.tournament_id = '<tournament_id>';
--   SELECT id, username, name, surname, telegram_id FROM prod.users
--   WHERE deleted_at IS NULL AND (username ILIKE '%...%' OR surname ILIKE '%...%');
\set ON_ERROR_STOP on
\if :{?commit}
\else
\set commit false
\endif
SET search_path TO prod;

BEGIN;

-- psql variables are not interpolated inside DO blocks, so expose them via a temp table.
CREATE TEMP TABLE _p ON COMMIT DROP AS
SELECT :'tournament_id'::uuid AS t, :'old_user'::uuid AS o, :'new_user'::uuid AS n;

-- 1. Guards: any failure aborts the whole transaction.
DO $$
DECLARE
  p _p%ROWTYPE;
  t_status text;
BEGIN
  SELECT * INTO p FROM _p;

  SELECT status INTO t_status FROM tournaments WHERE id = p.t;
  IF t_status IS NULL THEN
    RAISE EXCEPTION 'Tournament % not found', p.t;
  END IF;
  IF t_status <> 'completed' THEN
    RAISE EXCEPTION 'Tournament % is %, expected completed', p.t, t_status;
  END IF;

  IF p.o = p.n THEN
    RAISE EXCEPTION 'old_user and new_user are the same account';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p.o) THEN
    RAISE EXCEPTION 'old_user % not found', p.o;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p.n AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'new_user % not found or deleted', p.n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tournament_participants WHERE tournament_id = p.t AND user_id = p.o
  ) THEN
    RAISE EXCEPTION 'old_user % is not a participant of tournament %', p.o, p.t;
  END IF;

  -- Composite PKs (tournament_id, user_id): moving would create a duplicate.
  IF EXISTS (
    SELECT 1 FROM tournament_participants WHERE tournament_id = p.t AND user_id = p.n
  ) THEN
    RAISE EXCEPTION 'new_user % is already a participant of tournament %', p.n, p.t;
  END IF;
  IF EXISTS (
    SELECT 1 FROM tournament_referees WHERE tournament_id = p.t AND user_id = p.n
  ) THEN
    RAISE EXCEPTION 'new_user % is already a referee of tournament %', p.n, p.t;
  END IF;

  -- A head-to-head match would become a match against oneself.
  IF EXISTS (
    SELECT 1 FROM matches
    WHERE tournament_id = p.t
      AND ((player1_id = p.o AND player2_id = p.n) OR (player1_id = p.n AND player2_id = p.o))
  ) THEN
    RAISE EXCEPTION 'old_user and new_user played each other in tournament %', p.t;
  END IF;
END $$;

-- 2. Junctions with composite PKs (status and seed move with the row).
UPDATE tournament_participants SET user_id = _p.n FROM _p
WHERE tournament_id = _p.t AND user_id = _p.o;
UPDATE tournament_referees SET user_id = _p.n FROM _p
WHERE tournament_id = _p.t AND user_id = _p.o;

-- 3. Matches. updated_at is deliberately left alone (only the app's $onUpdate sets it).
UPDATE matches SET player1_id = _p.n FROM _p WHERE tournament_id = _p.t AND player1_id = _p.o;
UPDATE matches SET player2_id = _p.n FROM _p WHERE tournament_id = _p.t AND player2_id = _p.o;
UPDATE matches SET winner_id = _p.n FROM _p WHERE tournament_id = _p.t AND winner_id = _p.o;
UPDATE matches SET reported_by = _p.n FROM _p WHERE tournament_id = _p.t AND reported_by = _p.o;
UPDATE matches SET confirmed_by = _p.n FROM _p WHERE tournament_id = _p.t AND confirmed_by = _p.o;

-- 4. Correction log.
UPDATE match_corrections SET corrected_by = _p.n FROM _p
WHERE tournament_id = _p.t AND corrected_by = _p.o;
UPDATE match_corrections SET previous_winner_id = _p.n FROM _p
WHERE tournament_id = _p.t AND previous_winner_id = _p.o;
UPDATE match_corrections SET new_winner_id = _p.n FROM _p
WHERE tournament_id = _p.t AND new_winner_id = _p.o;

-- 5. Disqualifications.
UPDATE disqualifications SET user_id = _p.n FROM _p
WHERE tournament_id = _p.t AND user_id = _p.o;
UPDATE disqualifications SET disqualified_by = _p.n FROM _p
WHERE tournament_id = _p.t AND disqualified_by = _p.o;

-- 6. Notifications about this tournament.
UPDATE notifications SET user_id = _p.n FROM _p
WHERE tournament_id = _p.t AND user_id = _p.o;

-- 7. Tombstone the placeholder if no FK column references it anymore (same as anonymizeUser).
DO $$
DECLARE
  p _p%ROWTYPE;
  refs int;
BEGIN
  SELECT * INTO p FROM _p;

  SELECT
      (SELECT count(*) FROM tournament_participants WHERE user_id = p.o)
    + (SELECT count(*) FROM tournament_referees WHERE user_id = p.o)
    + (SELECT count(*) FROM matches
       WHERE p.o IN (player1_id, player2_id, winner_id, reported_by, confirmed_by))
    + (SELECT count(*) FROM match_corrections
       WHERE p.o IN (corrected_by, previous_winner_id, new_winner_id))
    + (SELECT count(*) FROM disqualifications WHERE p.o IN (user_id, disqualified_by))
    + (SELECT count(*) FROM notifications WHERE user_id = p.o)
    + (SELECT count(*) FROM tournaments WHERE created_by = p.o)
    + (SELECT count(*) FROM group_chats WHERE added_by = p.o)
  INTO refs;

  IF refs > 0 THEN
    RAISE NOTICE 'old_user % still has % reference(s) outside this tournament; not deleted', p.o, refs;
  ELSE
    UPDATE users SET
      username = 'Удалённый аккаунт',
      telegram_id = NULL,
      name = NULL,
      surname = NULL,
      phone = NULL,
      email = NULL,
      role = 'user',
      deleted_at = now()
    WHERE id = p.o AND deleted_at IS NULL;
    DELETE FROM login_tokens WHERE user_id = p.o;
    DELETE FROM user_identities WHERE user_id = p.o;
    RAISE NOTICE 'old_user % tombstoned', p.o;
  END IF;
END $$;

-- 8. Report.
\echo '--- participant row (should be new_user)'
SELECT tp.user_id, u.username, u.name, u.surname, u.telegram_id, tp.status, tp.seed
FROM tournament_participants tp JOIN users u ON u.id = tp.user_id, _p
WHERE tp.tournament_id = _p.t AND tp.user_id = _p.n;

\echo '--- new_user matches in this tournament'
SELECT m.round, m.position, m.status,
       CASE WHEN m.player1_id = _p.n THEN m.player2_id ELSE m.player1_id END AS opponent_id,
       coalesce(nullif(concat_ws(' ', ou.name, ou.surname), ''), ou.username) AS opponent,
       CASE WHEN m.player1_id = _p.n THEN m.player1_score ELSE m.player2_score END AS my_score,
       CASE WHEN m.player1_id = _p.n THEN m.player2_score ELSE m.player1_score END AS opp_score,
       m.winner_id = _p.n AS won
FROM matches m
CROSS JOIN _p
LEFT JOIN users ou
  ON ou.id = CASE WHEN m.player1_id = _p.n THEN m.player2_id ELSE m.player1_id END
WHERE m.tournament_id = _p.t AND _p.n IN (m.player1_id, m.player2_id)
ORDER BY m.round, m.position;

\echo '--- references to old_user left in this tournament (should be 0)'
SELECT
    (SELECT count(*) FROM tournament_participants tp WHERE tp.tournament_id = _p.t AND tp.user_id = _p.o)
  + (SELECT count(*) FROM tournament_referees tr WHERE tr.tournament_id = _p.t AND tr.user_id = _p.o)
  + (SELECT count(*) FROM matches m WHERE m.tournament_id = _p.t
     AND _p.o IN (m.player1_id, m.player2_id, m.winner_id, m.reported_by, m.confirmed_by))
  + (SELECT count(*) FROM match_corrections mc WHERE mc.tournament_id = _p.t
     AND _p.o IN (mc.corrected_by, mc.previous_winner_id, mc.new_winner_id))
  + (SELECT count(*) FROM disqualifications d WHERE d.tournament_id = _p.t
     AND _p.o IN (d.user_id, d.disqualified_by))
  + (SELECT count(*) FROM notifications nt WHERE nt.tournament_id = _p.t AND nt.user_id = _p.o)
  AS old_user_refs_in_tournament
FROM _p;

\echo '--- old_user'
SELECT u.id, u.username, u.deleted_at FROM users u, _p WHERE u.id = _p.o;

-- 9. Persist only with -v commit=1.
\if :commit
COMMIT;
\echo 'COMMITTED'
\else
ROLLBACK;
\echo 'DRY RUN: rolled back. Re-run with -v commit=1 to apply.'
\endif
