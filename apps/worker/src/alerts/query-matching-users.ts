import { db, users, subscriptions, eq, and, sql } from "@mn-platform/db";

export interface MatchedUser {
  userId: string;
}

export async function queryMatchingUsers(category: string | null): Promise<MatchedUser[]> {
  if (!category) return [];

  return db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(subscriptions, sql`${subscriptions.orgId} = ${users.orgId}`)
    .where(
      and(
        eq(subscriptions.status, "active"),
        sql`'tender' = ANY(${subscriptions.modules})`,
        sql`cardinality(${subscriptions.categories}) > 0`,
        sql`${category} = ANY(${subscriptions.categories})`,
      ),
    );
}
