// apps/worker/src/scheduler.ts
import * as Sentry from "@sentry/node";
import PgBoss from "pg-boss";
import {
  runPipeline,
  sendTelegramMessage,
  formatListingAlert,
  formatTenderAlert,
} from "@mn-platform/core";
import type { Source, TenderRecord, ListingRecord } from "@mn-platform/core";
import type { DbAdapter } from "./db-adapter.js";
import { tenderGovMnSource } from "./sources/tender-gov-mn.js";
import { openDataTenderSource } from "./sources/opendata-tender-gov-mn.js";
import { uneguiSaleSource, uneguiRentSource } from "./sources/unegui-mn.js";
import { warnZeroValueListing } from "./sources/listing-schema.js";
import { makeAlertDispatchHandler } from "./jobs/alert-dispatch.js";
import { makeListingAlertDispatchHandler } from "./jobs/listing-alert-dispatch.js";
import { queryMatchingUsers } from "./alerts/query-matching-users.js";
import { queryMatchingListingUsers } from "./alerts/query-matching-listing-users.js";
import { logger } from "./logger.js";
import type { WorkerState } from "./types.js";

type TenderAdapter = "scrape" | "api";

function resolveTenderAdapter(): TenderAdapter {
  const raw = process.env["TENDER_ADAPTER"] ?? "scrape";
  if (raw !== "scrape" && raw !== "api") {
    throw new Error(
      `TENDER_ADAPTER must be "scrape" or "api", got "${raw}"`,
    );
  }
  return raw;
}

function getRawString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === "string" ? value : "";
}

// ── ops Telegram feed ────────────────────────────────────────────────────────
// Internal "something changed" ping to a single TELEGRAM_CHAT_ID — NOT the
// customer-facing alert system (apps/worker/src/alerts/dispatch.ts +
// notifications_sent). Best-effort: failures are logged and swallowed so a
// Telegram outage never fails or retries a scrape job.

async function notifyListingChanged(
  record: ListingRecord,
  outcome: "created" | "updated",
  previous: Partial<ListingRecord> | undefined,
): Promise<void> {
  const url = `https://www.unegui.mn${getRawString(record.raw, "detailPath")}`;

  const text = formatListingAlert(
    {
      listingType:       record.listingType,
      district:          record.district,
      khoroo:            record.khoroo,
      building:          record.building,
      areaM2:            record.areaM2,
      floor:             record.floor,
      priceMnt:          record.priceMnt,
      url,
      previousPriceMnt:  previous?.priceMnt,
    },
    outcome === "created" ? "new" : "changed",
  );

  await sendTelegramMessage(text).catch((err) =>
    logger.warn(
      { err, event: "telegram_send_failed", externalId: record.externalId },
      "ops telegram failed, continuing",
    ),
  );
}

async function notifyTenderChanged(record: TenderRecord): Promise<void> {
  const title = getRawString(record.raw, "title") || record.tenderNo || record.externalId;
  const url = `https://user.tender.gov.mn${getRawString(record.raw, "detailPath")}`;

  const text = formatTenderAlert({
    procuringEntity:    record.procuringEntity,
    title,
    submissionDeadline: record.submissionDeadline,
    estBudgetMnt:       record.estBudgetMnt,
    url,
  });

  await sendTelegramMessage(text).catch((err) =>
    logger.warn(
      { err, event: "telegram_send_failed", externalId: record.externalId },
      "ops telegram failed, continuing",
    ),
  );
}

export async function registerJobs(
  boss: PgBoss,
  db: DbAdapter,
  state: WorkerState,
): Promise<void> {
  // ── scrape.tender-gov-mn ────────────────────────────────────────────────────
  const adapter = resolveTenderAdapter();
  const tenderSource: Source<unknown, TenderRecord> =
    adapter === "scrape" ? tenderGovMnSource : openDataTenderSource;

  await boss.schedule("scrape.tender-gov-mn", "0 */2 * * *", undefined, {
    tz: "Asia/Ulaanbaatar",
  });
  await boss.work(
    "scrape.tender-gov-mn",
    { batchSize: 2 },
    async (_jobs: PgBoss.Job<unknown>[]) => {
      try {
        const result = await runPipeline({
          source: tenderSource,
          upsert: db.upsertTender,
          onChanged: async (record, _outcome, _previous, dbId) => {
            // Ops Telegram feed (best-effort)
            await notifyTenderChanged(record);

            // Customer alert fan-out — skip if no DB id or no category to match
            if (!dbId || !record.category) return;

            const hash = tenderSource.contentHash(record);
            let matches: { userId: string }[] = [];
            try {
              matches = await queryMatchingUsers(record.category);
            } catch (err) {
              logger.warn(
                { err, category: record.category, event: "query_matching_users_failed" },
                "alert fan-out aborted",
              );
              return;
            }

            for (const { userId } of matches) {
              await boss
                .send("alert.dispatch", { recordId: dbId, contentHash: hash, userId })
                .catch((err) =>
                  logger.warn(
                    { err, userId, event: "alert_enqueue_failed" },
                    "alert.dispatch enqueue failed",
                  ),
                );
            }
          },
        });
        state.lastRunAt = new Date();
        logger.info({ ...result, adapter, event: "scrape_complete" });
      } catch (err) {
        logger.error({ source: "tender.gov.mn", event: "scrape_error", error: err instanceof Error ? err.message : String(err) });
        Sentry.captureException(err);
        throw err;
      }
    },
  );

  // ── scrape.unegui-sale ──────────────────────────────────────────────────────
  await boss.schedule("scrape.unegui-sale", "0 1 * * *", undefined, {
    tz: "Asia/Ulaanbaatar",
  });
  await boss.work(
    "scrape.unegui-sale",
    { batchSize: 1 },
    async (_jobs: PgBoss.Job<unknown>[]) => {
      try {
        const result = await runPipeline({
          source: uneguiSaleSource,
          upsert: db.upsertListing,
          onValidated: (record) => warnZeroValueListing(uneguiSaleSource.id, record),
          getPrevious: (record) => db.getPreviousListingPrice(uneguiSaleSource.id, record),
          onChanged: async (record, outcome, previous, dbId) => {
            await notifyListingChanged(record, outcome, previous);
            if (!dbId) return;
            const hash = uneguiSaleSource.contentHash(record);
            let matches: { userId: string; telegramChatId: string }[] = [];
            try {
              matches = await queryMatchingListingUsers({
                listingType: record.listingType,
                district:    record.district,
                priceMnt:    record.priceMnt,
                rooms:       record.rooms,
              });
            } catch (err) {
              logger.warn({ err, event: "query_matching_listing_users_failed" }, "listing alert fan-out aborted");
              return;
            }
            for (const { userId, telegramChatId } of matches) {
              await boss
                .send("listing.alert.dispatch", { recordId: dbId, contentHash: hash, userId, telegramChatId })
                .catch((err) =>
                  logger.warn({ err, userId, event: "listing_alert_enqueue_failed" }, "listing.alert.dispatch enqueue failed"),
                );
            }
          },
        });
        state.lastRunAt = new Date();
        logger.info({ ...result, event: "scrape_complete" });
        if (result.pagesFetched > 0 && result.emptyPages === result.pagesFetched) {
          Sentry.captureMessage("All pages returned 0 listings — likely selector drift", {
            level: "error",
            extra: { source: uneguiSaleSource.id, listingType: "sale", pagesFetched: result.pagesFetched },
          });
        }
      } catch (err) {
        logger.error({ source: "unegui.mn/sale", event: "scrape_error", error: err instanceof Error ? err.message : String(err) });
        Sentry.captureException(err);
        throw err;
      }
    },
  );

  // ── scrape.unegui-rent ──────────────────────────────────────────────────────
  // 2-hour stagger from sale — same domain + rate limiter, avoid overlap.
  await boss.schedule("scrape.unegui-rent", "0 3 * * *", undefined, {
    tz: "Asia/Ulaanbaatar",
  });
  await boss.work(
    "scrape.unegui-rent",
    { batchSize: 1 },
    async (_jobs: PgBoss.Job<unknown>[]) => {
      try {
        const result = await runPipeline({
          source: uneguiRentSource,
          upsert: db.upsertListing,
          onValidated: (record) => warnZeroValueListing(uneguiRentSource.id, record),
          getPrevious: (record) => db.getPreviousListingPrice(uneguiRentSource.id, record),
          onChanged: async (record, outcome, previous, dbId) => {
            await notifyListingChanged(record, outcome, previous);
            if (!dbId) return;
            const hash = uneguiRentSource.contentHash(record);
            let matches: { userId: string; telegramChatId: string }[] = [];
            try {
              matches = await queryMatchingListingUsers({
                listingType: record.listingType,
                district:    record.district,
                priceMnt:    record.priceMnt,
                rooms:       record.rooms,
              });
            } catch (err) {
              logger.warn({ err, event: "query_matching_listing_users_failed" }, "listing alert fan-out aborted");
              return;
            }
            for (const { userId, telegramChatId } of matches) {
              await boss
                .send("listing.alert.dispatch", { recordId: dbId, contentHash: hash, userId, telegramChatId })
                .catch((err) =>
                  logger.warn({ err, userId, event: "listing_alert_enqueue_failed" }, "listing.alert.dispatch enqueue failed"),
                );
            }
          },
        });
        state.lastRunAt = new Date();
        logger.info({ ...result, event: "scrape_complete" });
        if (result.pagesFetched > 0 && result.emptyPages === result.pagesFetched) {
          Sentry.captureMessage("All pages returned 0 listings — likely selector drift", {
            level: "error",
            extra: { source: uneguiRentSource.id, listingType: "rent", pagesFetched: result.pagesFetched },
          });
        }
      } catch (err) {
        logger.error({ source: "unegui.mn/rent", event: "scrape_error", error: err instanceof Error ? err.message : String(err) });
        Sentry.captureException(err);
        throw err;
      }
    },
  );

  // ── alert.dispatch (tenders) ────────────────────────────────────────────────
  await boss.work(
    "alert.dispatch",
    { batchSize: 5 },
    makeAlertDispatchHandler(),
  );

  // ── listing.alert.dispatch (gazar listings) ──────────────────────────────────
  await boss.work(
    "listing.alert.dispatch",
    { batchSize: 5 },
    makeListingAlertDispatchHandler(),
  );

  // ── export.generate ─────────────────────────────────────────────────────────
  await boss.work(
    "export.generate",
    { batchSize: 1 },
    async (_jobs: PgBoss.Job<unknown>[]) => {
      logger.warn({ event: "export_generate_stub" }, "export.generate stub: not yet implemented");
    },
  );

  logger.info({ adapter, event: "jobs_registered" }, "all jobs registered");
}
