import { db, notificationsSent } from "@mn-platform/db";

interface InsertParams {
  recordId: string;
  contentHash: string;
  userId: string;
  channel: string;
}

/**
 * Returns true if a new row was inserted (notification is new).
 * Returns false if the row already existed (conflict — notification already logged).
 *
 * IMPORTANT: call this AFTER a successful provider.send(), not before.
 * A failed send leaves no record, giving pg-boss a clean retry path.
 */
export async function insertNotificationSent(
  params: InsertParams,
): Promise<boolean> {
  const result = await db
    .insert(notificationsSent)
    .values({
      recordId:    params.recordId,
      contentHash: params.contentHash,
      userId:      params.userId,
      channel:     params.channel,
    })
    .onConflictDoNothing()
    .returning({ id: notificationsSent.id });

  return result.length > 0;
}
