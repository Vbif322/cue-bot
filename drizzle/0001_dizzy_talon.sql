CREATE TABLE "prod"."match_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"corrected_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"previous_player1_score" integer,
	"previous_player2_score" integer,
	"previous_winner_id" uuid,
	"new_player1_score" integer,
	"new_player2_score" integer,
	"new_winner_id" uuid,
	"affected_match_ids" uuid[],
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD COLUMN "is_corrected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD COLUMN "correction_reason" text;--> statement-breakpoint
ALTER TABLE "prod"."match_corrections" ADD CONSTRAINT "match_corrections_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "prod"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."match_corrections" ADD CONSTRAINT "match_corrections_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "prod"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."match_corrections" ADD CONSTRAINT "match_corrections_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."match_corrections" ADD CONSTRAINT "match_corrections_previous_winner_id_users_id_fk" FOREIGN KEY ("previous_winner_id") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."match_corrections" ADD CONSTRAINT "match_corrections_new_winner_id_users_id_fk" FOREIGN KEY ("new_winner_id") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;