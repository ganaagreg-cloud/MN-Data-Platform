DROP INDEX "subscriptions_org_id_idx";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "categories" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_id_idx" ON "subscriptions" USING btree ("org_id");