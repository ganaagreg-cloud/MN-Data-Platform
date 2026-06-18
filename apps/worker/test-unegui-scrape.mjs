// Quick manual test: run the unegui.mn sale scraper end-to-end
// Usage: node --env-file=../../.env test-unegui-scrape.mjs
import { runPipeline, sendTelegramMessage, formatListingAlert } from "@mn-platform/core";
import { uneguiSaleSource } from "./src/sources/unegui-mn.js";
import { createDbAdapter } from "./src/db-adapter.js";
import { warnZeroValueListing } from "./src/sources/listing-schema.js";

const db = createDbAdapter();

console.log("🚀 Starting unegui.mn SALE scrape...\n");

async function notifyChanged(record, outcome, previous) {
  const detailPath = typeof record.raw?.detailPath === "string" ? record.raw.detailPath : "";
  const url = `https://www.unegui.mn${detailPath}`;
  const text = formatListingAlert(
    {
      listingType:      record.listingType,
      district:         record.district,
      khoroo:           record.khoroo,
      building:         record.building,
      areaM2:           record.areaM2,
      floor:            record.floor,
      priceMnt:         record.priceMnt,
      url,
      previousPriceMnt: previous?.priceMnt,
    },
    outcome === "created" ? "new" : "changed",
  );
  await sendTelegramMessage(text).catch((err) =>
    console.warn("  [TELEGRAM WARN]", err.message),
  );
}

try {
  const result = await runPipeline({
    source: uneguiSaleSource,
    upsert: db.upsertListing,
    onValidated: (record) => warnZeroValueListing(uneguiSaleSource.id, record),
    getPrevious: (record) => db.getPreviousListingPrice(uneguiSaleSource.id, record),
    onChanged: async (record, outcome, previous) => {
      const price = record.priceMnt?.toLocaleString() ?? "?";
      const prevPrice = previous?.priceMnt?.toLocaleString();
      const priceStr = prevPrice ? `₮${prevPrice} → ₮${price}` : `₮${price}`;
      console.log(`  [${outcome.toUpperCase()}] ${record.district} ${record.khoroo ?? ""} | ${record.areaM2}м² | ${priceStr}`);
      await notifyChanged(record, outcome, previous);
    },
  });

  console.log("\n✅ Done!");
  console.log(`   Pages fetched:  ${result.pagesFetched}`);
  console.log(`   Total fetched:  ${result.fetched}`);
  console.log(`   New:            ${result.created}`);
  console.log(`   Updated:        ${result.updated}`);
  console.log(`   Unchanged:      ${result.unchanged}`);
  console.log(`   Errors:         ${result.errors}`);
  console.log(`   Duration:       ${result.durationMs}ms`);
} catch (err) {
  console.error("❌ Scrape failed:", err);
  process.exit(1);
}

process.exit(0);
