import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ── shared helper ────────────────────────────────────────────────────────────
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

// ── organizations ─────────────────────────────────────────────────────────────
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  ...timestamps,
});

// ── users ─────────────────────────────────────────────────────────────────────
export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .references(() => organizations.id)
      .notNull(),
    email: text("email"),
    name: text("name"),
    telegramId: bigint("telegram_id", { mode: "number" }),
    telegramChatId: text("telegram_chat_id"),
    telegramUsername: text("telegram_username"),
    phone: text("phone"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_telegram_id_idx").on(t.telegramId),
    index("users_org_id_idx").on(t.orgId),
  ],
);

// ── subscriptions ─────────────────────────────────────────────────────────────
// modules: ("tender" | "gazar")[]
// alertChannels: ("email" | "telegram" | "sms")[]
// status: trial | active | expired | cancelled
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .references(() => organizations.id)
      .notNull(),
    modules: text("modules").array().notNull().default([]),
    categories: text("categories").array().notNull().default([]),
    alertChannels: text("alert_channels").array().notNull().default([]),
    status: text("status").notNull().default("trial"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscriptions_org_id_idx").on(t.orgId),
    index("subscriptions_status_idx").on(t.status),
  ],
);

// ── tenders ───────────────────────────────────────────────────────────────────
// status machine: announced → open → closed → awarded → cancelled
export const tenders = pgTable(
  "tenders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id").notNull(),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    raw: jsonb("raw").notNull(),
    tenderNo: text("tender_no"),
    procuringEntity: text("procuring_entity"),
    category: text("category"),
    estBudgetMnt: numeric("est_budget_mnt", { precision: 18, scale: 2 }),
    announceDate: timestamp("announce_date", { withTimezone: true }),
    submissionDeadline: timestamp("submission_deadline", { withTimezone: true }),
    bidSecurityMnt: numeric("bid_security_mnt", { precision: 18, scale: 2 }),
    aimag: text("aimag"),
    status: text("status").notNull().default("announced"),
    fetchedVia: text("fetched_via"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tenders_source_external_idx").on(t.sourceId, t.externalId),
    index("tenders_submission_deadline_idx").on(t.submissionDeadline),
    index("tenders_status_idx").on(t.status),
    index("tenders_category_idx").on(t.category),
    index("tenders_aimag_idx").on(t.aimag),
  ],
);

// ── listings ──────────────────────────────────────────────────────────────────
// district enum: БЗД | СБД | ЧД | ХУД | СХД | БГД | Налайх | Багануур | Багахангай
// pricePerM2 is derived — stored for fast aggregate queries, never republished
export const listings = pgTable(
  "listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id").notNull(),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    raw: jsonb("raw").notNull(),
    listingType: text("listing_type", { enum: ["sale", "rent"] }).notNull(),
    district: text("district"),
    khoroo: text("khoroo"),
    rooms: integer("rooms"),
    areaM2: numeric("area_m2", { precision: 8, scale: 2 }),
    floor: integer("floor"),
    building: text("building"),
    priceMnt: numeric("price_mnt", { precision: 18, scale: 2 }),
    pricePerM2: numeric("price_per_m2", { precision: 18, scale: 2 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("listings_source_external_idx").on(t.sourceId, t.externalId),
    index("listings_district_idx").on(t.district),
    index("listings_price_per_m2_idx").on(t.pricePerM2),
    index("listings_created_at_idx").on(t.createdAt),
    index("listings_type_district_idx").on(t.listingType, t.district),
  ],
);

// ── notifications_sent ────────────────────────────────────────────────────────
// Idempotency log: one row per (record_id, content_hash, user_id, channel).
// record_id is text (not FK) — covers both tenders and listings.
export const notificationsSent = pgTable(
  "notifications_sent",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordId: text("record_id").notNull(),
    contentHash: text("content_hash").notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    channel: text("channel").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("notifications_sent_dedup_idx").on(
      t.recordId,
      t.contentHash,
      t.userId,
      t.channel,
    ),
    index("notifications_sent_user_idx").on(t.userId),
  ],
);
