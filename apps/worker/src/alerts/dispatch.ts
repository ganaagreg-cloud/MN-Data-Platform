import { eq, and } from "drizzle-orm";
import { db, users, subscriptions, tenders } from "@mn-platform/db";
import type { ChannelProvider, AlertJobPayload } from "./types.js";
import { formatTenderNotification } from "./notify-builder.js";
import { insertNotificationSent } from "./idempotency.js";
import { logger } from "../logger.js";

export async function dispatchAlert(
  payload: AlertJobPayload,
  providers: ChannelProvider[],
): Promise<void> {
  // Step 1: load user
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
  });
  if (!user) {
    logger.warn({ userId: payload.userId }, "dispatchAlert: user not found — skipping");
    return;
  }

  // Step 1b: load subscription for user's org
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.orgId, user.orgId),
    ),
  });
  if (!subscription) {
    logger.warn({ userId: payload.userId }, "dispatchAlert: subscription not found — skipping");
    return;
  }

  // Step 2: gate — active subscriptions only
  if (subscription.status !== "active") {
    logger.info(
      { userId: payload.userId, status: subscription.status },
      "dispatchAlert: subscription not active — skipping",
    );
    return;
  }

  // Step 3: load tender
  const tender = await db.query.tenders.findFirst({
    where: eq(tenders.id, payload.recordId),
  });
  if (!tender) {
    logger.warn({ recordId: payload.recordId }, "dispatchAlert: tender not found — skipping");
    return;
  }

  // Step 4: build notification
  const notification = formatTenderNotification(tender, payload.contentHash);

  // Step 5: build recipient (exactOptionalPropertyTypes — omit absent fields)
  const recipient: import("./types.js").Recipient = {
    userId: user.id,
    ...(user.email          != null && { email:          user.email }),
    ...(user.telegramChatId != null && { telegramChatId: user.telegramChatId }),
    ...(user.phone          != null && { phone:          user.phone }),
  };

  const errors: Error[] = [];

  // Step 6: fan out to each subscribed channel
  for (const channel of subscription.alertChannels) {
    const provider = providers.find((p) => p.channel === channel);
    if (!provider) {
      logger.warn({ channel }, "dispatchAlert: no provider registered for channel — skipping");
      continue;
    }

    // Channel gates
    if (channel === "email" && !recipient.email) {
      logger.info({ userId: user.id }, "dispatchAlert: email not set — skipping email");
      continue;
    }
    if (channel === "telegram" && !recipient.telegramChatId) {
      logger.info({ userId: user.id }, "dispatchAlert: telegram_chat_id not set — skipping telegram");
      continue;
    }

    try {
      await provider.send(notification, recipient);
      await insertNotificationSent({
        recordId:    payload.recordId,
        contentHash: payload.contentHash,
        userId:      payload.userId,
        channel,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error({ channel, userId: user.id, message: error.message }, "channel dispatch failed");
      errors.push(error);
    }
  }

  // Re-throw first error so pg-boss retries the job.
  if (errors.length > 0) {
    throw errors[0]!;
  }
}
