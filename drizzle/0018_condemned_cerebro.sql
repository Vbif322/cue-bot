CREATE TABLE "prod"."match_frames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"frame_number" integer NOT NULL,
	"player1_points" integer NOT NULL,
	"player2_points" integer NOT NULL,
	"player1_break" integer,
	"player2_break" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "match_frames_frame_number_nonneg" CHECK ("prod"."match_frames"."frame_number" >= 0),
	CONSTRAINT "match_frames_p1_points_nonneg" CHECK ("prod"."match_frames"."player1_points" >= 0),
	CONSTRAINT "match_frames_p2_points_nonneg" CHECK ("prod"."match_frames"."player2_points" >= 0),
	CONSTRAINT "match_frames_p1_break_nonneg" CHECK ("prod"."match_frames"."player1_break" >= 0),
	CONSTRAINT "match_frames_p2_break_nonneg" CHECK ("prod"."match_frames"."player2_break" >= 0)
);
--> statement-breakpoint
ALTER TABLE "prod"."match_frames" ADD CONSTRAINT "match_frames_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "prod"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_frames_match_id_idx" ON "prod"."match_frames" USING btree ("match_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_frames_match_frame_uq" ON "prod"."match_frames" USING btree ("match_id","frame_number");