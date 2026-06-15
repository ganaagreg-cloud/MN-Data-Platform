CREATE TABLE "auth_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"telegram_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_id" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_idx" ON "users" USING btree ("telegram_id");