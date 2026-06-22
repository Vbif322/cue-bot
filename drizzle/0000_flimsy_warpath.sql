CREATE TABLE "prod"."disqualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"disqualified_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prod"."login_codes" (
	"username" varchar(255) PRIMARY KEY NOT NULL,
	"code" varchar(6) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prod"."login_tokens" (
	"token" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prod"."matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"position" integer NOT NULL,
	"player1_id" uuid,
	"player2_id" uuid,
	"player1_is_walkover" boolean DEFAULT false NOT NULL,
	"player2_is_walkover" boolean DEFAULT false NOT NULL,
	"winner_id" uuid,
	"player1_score" integer,
	"player2_score" integer,
	"status" varchar DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"reported_by" uuid,
	"confirmed_by" uuid,
	"is_technical_result" boolean DEFAULT false NOT NULL,
	"technical_reason" text,
	"next_match_id" uuid,
	"next_match_position" varchar(10),
	"bracketType" varchar(20) DEFAULT 'winners',
	"losers_next_match_position" integer,
	"table_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prod"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"tournament_id" uuid,
	"match_id" uuid,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_sent" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prod"."tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"venue_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prod"."tournament_participants" (
	"tournament_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"seed" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_participants_tournament_id_user_id_pk" PRIMARY KEY("tournament_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "prod"."tournament_referees" (
	"tournament_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_referees_tournament_id_user_id_pk" PRIMARY KEY("tournament_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "prod"."tournament_tables" (
	"tournament_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tournament_tables_tournament_id_table_id_pk" PRIMARY KEY("tournament_id","table_id")
);
--> statement-breakpoint
CREATE TABLE "prod"."tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"discipline" varchar NOT NULL,
	"format" varchar NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"start_date" timestamp,
	"confirmed_participants" integer,
	"max_participants" integer DEFAULT 16 NOT NULL,
	"win_score" integer DEFAULT 3 NOT NULL,
	"rules" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prod"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" varchar(255),
	"username" varchar(255) NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"name" varchar(50),
	"surname" varchar(100),
	"birthday" date,
	"role" varchar DEFAULT 'user' NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "prod"."venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" text NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prod"."disqualifications" ADD CONSTRAINT "disqualifications_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "prod"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."disqualifications" ADD CONSTRAINT "disqualifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "prod"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."disqualifications" ADD CONSTRAINT "disqualifications_disqualified_by_users_id_fk" FOREIGN KEY ("disqualified_by") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."login_tokens" ADD CONSTRAINT "login_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "prod"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD CONSTRAINT "matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "prod"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD CONSTRAINT "matches_player1_id_users_id_fk" FOREIGN KEY ("player1_id") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD CONSTRAINT "matches_player2_id_users_id_fk" FOREIGN KEY ("player2_id") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD CONSTRAINT "matches_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD CONSTRAINT "matches_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD CONSTRAINT "matches_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."matches" ADD CONSTRAINT "matches_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "prod"."tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "prod"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."notifications" ADD CONSTRAINT "notifications_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "prod"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."notifications" ADD CONSTRAINT "notifications_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "prod"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."tables" ADD CONSTRAINT "tables_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "prod"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."tournament_participants" ADD CONSTRAINT "tournament_participants_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "prod"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."tournament_participants" ADD CONSTRAINT "tournament_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "prod"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."tournament_referees" ADD CONSTRAINT "tournament_referees_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "prod"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."tournament_referees" ADD CONSTRAINT "tournament_referees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "prod"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."tournament_tables" ADD CONSTRAINT "tournament_tables_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "prod"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."tournament_tables" ADD CONSTRAINT "tournament_tables_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "prod"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD CONSTRAINT "tournaments_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "prod"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."tournaments" ADD CONSTRAINT "tournaments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "prod"."users"("id") ON DELETE no action ON UPDATE no action;