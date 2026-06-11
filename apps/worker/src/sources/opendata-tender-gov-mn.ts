// apps/worker/src/sources/opendata-tender-gov-mn.ts
//
// Stub adapter for opendata.tender.gov.mn REST API (Bearer token, POST).
// Same source_id as the Playwright adapter — they form a fallback chain;
// only one runs at a time, selected by TENDER_ADAPTER env var.
//
// Wire this in when:
//   1. OPENDATA_BEARER_TOKEN is available
//   2. API response shape is documented
//
// TODO before implementing fetchPage:
//   - Verify https://opendata.tender.gov.mn/robots.txt
//   - Add getRateLimiter("opendata.tender.gov.mn").acquire() before the fetch call
//   - Map the POST response envelope to { raw: RawApiTender[], nextCursor? }
//
// TODO before implementing parse:
//   - Map API JSON fields to TenderRecord using @mn-platform/mn helpers
//   - Set fetchedVia: "api"

import type { Source, TenderRecord } from "@mn-platform/core";
import { TenderRecordSchema, tenderContentHash } from "./tender-schema.js";

const SOURCE_ID = "tender.gov.mn";
const _BASE_URL = "https://opendata.tender.gov.mn";

interface RawApiTender extends Record<string, unknown> {}

export const openDataTenderSource: Source<RawApiTender, TenderRecord> = {
  id: SOURCE_ID,

  async fetchPage(_cursor?: string): Promise<{ raw: RawApiTender[]; nextCursor?: string }> {
    const token = process.env["OPENDATA_BEARER_TOKEN"];
    if (!token) {
      throw new Error(
        "opendata.tender.gov.mn: OPENDATA_BEARER_TOKEN env var not set — adapter cannot run",
      );
    }
    throw new Error(
      "opendata.tender.gov.mn: fetchPage not yet implemented — waiting for API docs",
    );
  },

  parse(_raw: RawApiTender): TenderRecord {
    throw new Error(
      "opendata.tender.gov.mn: parse not yet implemented — waiting for API docs",
    );
  },

  schema:      TenderRecordSchema,
  contentHash: tenderContentHash,
};
