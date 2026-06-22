CREATE TABLE "prod"."dialog_sessions" (
	"namespace" varchar(32) NOT NULL,
	"key" varchar(64) NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dialog_sessions_namespace_key_pk" PRIMARY KEY("namespace","key")
);
