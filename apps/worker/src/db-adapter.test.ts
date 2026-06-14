// apps/worker/src/db-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ListingRecord } from "@mn-platform/core";

const dialect = new PgDialect();

// Mock only the DB client — reuse the real (side-effect-free) schema exports
// so eq()/and() in db-adapter.ts build real SQL we can inspect. The real
// client.ts requires DATABASE_URL/DATABASE_URL_DIRECT at import time but
// (postgres-js) connects lazily, so dummy values are safe here.
process.env["DATABASE_URL"] ??= "postgres://test:test@localhost:5432/test";
process.env["DATABASE_URL_DIRECT"] ??= "postgres://test:test@localhost:5432/test";

vi.mock("@mn-platform/db", async () => {
  const actual = await vi.importActual<typeof import("@mn-platform/db")>("@mn-platform/db");
  return {
    ...actual,
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    },
  };
});

const { db } = await import("@mn-platform/db");
const { createDbAdapter } = await import("./db-adapter.js");

const rentRecord: ListingRecord = {
  externalId: "12345",
  listingType: "rent",
  district: "БЗД",
  khoroo: "1",
  rooms: 2,
  areaM2: 50,
  floor: 3,
  building: null,
  priceMnt: 1_000_000,
  pricePerM2: 20_000,
  raw: {},
};

describe("createDbAdapter().upsertListing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks up the existing row by sourceId + externalId + listingType", async () => {
    const whereSpy = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ where: whereSpy }),
    } as never);
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    } as never);

    await createDbAdapter().upsertListing("unegui.mn", "hash1", rentRecord);

    expect(whereSpy).toHaveBeenCalledOnce();
    const [condition] = whereSpy.mock.calls[0]!;
    const { sql } = dialect.sqlToQuery(condition);
    expect(sql).toContain('"source_id"');
    expect(sql).toContain('"external_id"');
    expect(sql).toContain('"listing_type"');
  });
});

describe("createDbAdapter().getPreviousListingPrice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the existing priceMnt as a number, looked up by sourceId + externalId + listingType", async () => {
    const whereSpy = vi
      .fn()
      .mockReturnValue({ limit: vi.fn().mockResolvedValue([{ priceMnt: "150000000.00" }]) });
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ where: whereSpy }),
    } as never);

    const result = await createDbAdapter().getPreviousListingPrice("unegui.mn", rentRecord);

    expect(result).toEqual({ priceMnt: 150_000_000 });
    const [condition] = whereSpy.mock.calls[0]!;
    const { sql } = dialect.sqlToQuery(condition);
    expect(sql).toContain('"source_id"');
    expect(sql).toContain('"external_id"');
    expect(sql).toContain('"listing_type"');
  });

  it("returns undefined when no existing row is found", async () => {
    const whereSpy = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ where: whereSpy }),
    } as never);

    const result = await createDbAdapter().getPreviousListingPrice("unegui.mn", rentRecord);

    expect(result).toBeUndefined();
  });

  it("returns a null priceMnt when the stored value is null", async () => {
    const whereSpy = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([{ priceMnt: null }]) });
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({ where: whereSpy }),
    } as never);

    const result = await createDbAdapter().getPreviousListingPrice("unegui.mn", rentRecord);

    expect(result).toEqual({ priceMnt: null });
  });
});
