ALTER TABLE "prod"."notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD COLUMN "called_at" timestamp;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD COLUMN "call_deadline_at" timestamp;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD COLUMN "player1_ready_at" timestamp;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD COLUMN "player2_ready_at" timestamp;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD COLUMN "no_show_alerted_at" timestamp;--> statement-breakpoint
ALTER TABLE "prod"."tournament_participants" ADD COLUMN "absent_since" timestamp;--> statement-breakpoint
ALTER TABLE "prod"."notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("prod"."notifications"."type" IN ('registration_confirmed', 'registration_rejected', 'bracket_formed', 'match_reminder', 'result_confirmation_request', 'result_confirmed', 'tournament_results', 'new_registration', 'participant_limit_reached', 'result_dispute', 'match_result_pending', 'disqualification', 'tournament_invitation', 'tournament_cancelled', 'match_no_show'));