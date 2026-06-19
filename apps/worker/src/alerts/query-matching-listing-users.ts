import { db, users, subscriptions, and, sql } from "@mn-platform/db";

export interface MatchedListingUser {
  userId: string;
  telegramChatId: string;
}

interface ListingCriteria {
  listingType: "sale" | "rent";
  district: string | null;
  priceMnt: number | null;
  rooms: number | null;
}

/**
 * Returns users whose subscription matches the given listing criteria.
 * Includes both 'trial' and 'active' subscriptions (trial users see alerts
 * to understand product value before paying).
 *
 * Each filter dimension short-circuits when the key is absent from
 * gazar_filters — absent key means "any" (no restriction on that dimension).
 *
 * Null listing fields (district, priceMnt, rooms) only match users who have
 * no filter set for that dimension — we can't confirm a match without data.
 */
export async function queryMatchingListingUsers(
  criteria: ListingCriteria,
): Promise<MatchedListingUser[]> {
  const { listingType, district, priceMnt, rooms } = criteria;

  const rows = await db
    .select({ userId: users.id, telegramChatId: users.telegramChatId })
    .from(users)
    .innerJoin(subscriptions, sql`${subscriptions.orgId} = ${users.orgId}`)
    .where(
      and(
        sql`${subscriptions.status} IN ('active', 'trial')`,
        sql`'gazar' = ANY(${subscriptions.modules})`,
        sql`${users.telegramChatId} IS NOT NULL`,
        // listingType filter
        sql`(
          ${subscriptions.gazarFilters}->'listingTypes' IS NULL
          OR ${subscriptions.gazarFilters}->'listingTypes' ? ${listingType}
        )`,
        // district filter — null district only matches users with no district filter
        district !== null
          ? sql`(
              ${subscriptions.gazarFilters}->'districts' IS NULL
              OR ${subscriptions.gazarFilters}->'districts' ? ${district}
            )`
          : sql`${subscriptions.gazarFilters}->'districts' IS NULL`,
        // rooms filter — null rooms only matches users with no rooms filter
        rooms !== null
          ? sql`(
              ${subscriptions.gazarFilters}->'rooms' IS NULL
              OR ${subscriptions.gazarFilters}->'rooms' ? ${String(rooms)}
            )`
          : sql`${subscriptions.gazarFilters}->'rooms' IS NULL`,
        // price range — null price only matches users with no price filters
        priceMnt !== null
          ? sql`(
              ${subscriptions.gazarFilters}->>'minPriceMnt' IS NULL
              OR ${priceMnt} >= (${subscriptions.gazarFilters}->>'minPriceMnt')::bigint
            )`
          : sql`${subscriptions.gazarFilters}->>'minPriceMnt' IS NULL`,
        priceMnt !== null
          ? sql`(
              ${subscriptions.gazarFilters}->>'maxPriceMnt' IS NULL
              OR ${priceMnt} <= (${subscriptions.gazarFilters}->>'maxPriceMnt')::bigint
            )`
          : sql`${subscriptions.gazarFilters}->>'maxPriceMnt' IS NULL`,
      ),
    );

  return rows.filter(
    (r): r is MatchedListingUser => r.telegramChatId !== null,
  );
}
