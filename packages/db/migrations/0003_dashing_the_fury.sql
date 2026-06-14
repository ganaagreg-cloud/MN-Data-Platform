-- Phase 1: add nullable — instant on Postgres 11+, no table rewrite/lock.
ALTER TABLE "listings" ADD COLUMN "listing_type" text;--> statement-breakpoint
-- Phase 2: backfill. listings is empty as of this migration (first
-- GazarPrice source adapter); default existing rows to 'sale' defensively
-- so Phase 3's NOT NULL can never fail on a populated table.
UPDATE "listings" SET "listing_type" = 'sale' WHERE "listing_type" IS NULL;--> statement-breakpoint
-- Phase 3: now safe to enforce NOT NULL + CHECK.
ALTER TABLE "listings" ALTER COLUMN "listing_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_listing_type_check" CHECK (listing_type IN ('sale', 'rent'));--> statement-breakpoint
CREATE INDEX "listings_type_district_idx" ON "listings" USING btree ("listing_type","district");