import PgBoss from "pg-boss";
import { dispatchListingAlert, ListingAlertPayloadSchema } from "../alerts/listing-dispatch.js";
import { logger } from "../logger.js";

export function makeListingAlertDispatchHandler() {
  return async function handler(jobs: PgBoss.Job<unknown>[]) {
    const job = jobs[0];
    if (!job) return;
    const payload = ListingAlertPayloadSchema.parse(job.data);
    await dispatchListingAlert(payload);
    logger.info(
      { recordId: payload.recordId, userId: payload.userId, event: "listing_alert_dispatched" },
      "listing alert dispatched",
    );
  };
}
