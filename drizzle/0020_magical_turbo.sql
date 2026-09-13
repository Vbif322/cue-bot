CREATE TABLE "prod"."group_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" varchar(32) NOT NULL,
	"tournament_id" uuid NOT NULL,
	"kind" varchar NOT NULL,
	"message_id" integer,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_announcements_kind_check" CHECK ("prod"."group_announcements"."kind" IN ('registration_open'))
);
--> statement-breakpoint
CREATE TABLE "prod"."group_chats" (
	"chat_id" varchar(32) PRIMARY KEY NOT NULL,
	"type" varchar NOT NULL,
	"title" varchar(255),
	"added_by" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"deactivated_at" timestamp,
	"deactivated_reason" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_chats_type_check" CHECK ("prod"."group_chats"."type" IN ('group', 'supergroup'))
);
--> statement-breakpoint
ALTER TABLE "prod"."group_announcements" ADD CONSTRAINT "group_announcements_chat_id_group_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "prod"."group_chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."group_announcements" ADD CONSTRAINT "group_announcements_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "prod"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prod"."group_chats" ADD CONSTRAINT "group_chats_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "prod"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_announcements_chat_tournament_kind_unique" ON "prod"."group_announcements" USING btree ("chat_id","tournament_id","kind");