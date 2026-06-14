// apps/platform/src/lib/upsert-telegram-user.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TelegramAuthPayload } from "./telegram-auth-schema.js";

// db-adapter.test.ts pattern: client.ts requires these at import time even
// though postgres-js connects lazily.
process.env["DATABASE_URL"] ??= "postgres://test:test@localhost:5432/test";
process.env["DATABASE_URL_DIRECT"] ??= "postgres://test:test@localhost:5432/test";

vi.mock("@mn-platform/db", async () => {
  const actual = await vi.importActual<typeof import("@mn-platform/db")>("@mn-platform/db");
  return {
    ...actual,
    db: {
      transaction: vi.fn(),
    },
  };
});

const { db, users, organizations } = await import("@mn-platform/db");
const { upsertTelegramUser } = await import("./upsert-telegram-user.js");

const basePayload: TelegramAuthPayload = {
  id: 12345,
  first_name: "Bat",
  username: "bat_mn",
  auth_date: 1_700_000_000,
  hash: "irrelevant-for-this-test",
};

interface MockTx {
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function makeTx(opts: {
  upsertedUser: Record<string, unknown> | undefined;
  insertedOrg?: Record<string, unknown> | undefined;
  updatedUser?: Record<string, unknown> | undefined;
}): MockTx {
  const insert = vi.fn((table: unknown) => {
    if (table === users) {
      return {
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(opts.upsertedUser ? [opts.upsertedUser] : []),
          }),
        }),
      };
    }
    if (table === organizations) {
      return {
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(opts.insertedOrg ? [opts.insertedOrg] : []),
        }),
      };
    }
    throw new Error("unexpected table passed to tx.insert");
  });

  const update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(opts.updatedUser ? [opts.updatedUser] : []),
      }),
    }),
  });

  return { insert, update };
}

describe("upsertTelegramUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a personal organization and links it when the user has no org_id", async () => {
    const tx = makeTx({
      upsertedUser: { id: "u1", telegramId: 12345, firstName: "Bat", orgId: null },
      insertedOrg: { id: "org1", name: "Bat's workspace" },
      updatedUser: { id: "u1", telegramId: 12345, firstName: "Bat", orgId: "org1" },
    });
    vi.mocked(db.transaction).mockImplementation((cb) => cb(tx as never));

    const result = await upsertTelegramUser(basePayload);

    expect(result).toEqual({ id: "u1", telegramId: 12345, firstName: "Bat", orgId: "org1" });
    expect(tx.insert).toHaveBeenCalledWith(organizations);
    expect(tx.update).toHaveBeenCalledWith(users);

    const orgValues = vi.mocked(tx.insert).mock.results.find(
      (r) => typeof r.value?.values === "function",
    );
    expect(orgValues).toBeDefined();
  });

  it("does not create a second org for a repeat login with org_id already set", async () => {
    const existingUser = {
      id: "u1",
      telegramId: 12345,
      firstName: "Bat",
      telegramUsername: "bat_mn",
      orgId: "org1",
    };
    const tx = makeTx({ upsertedUser: existingUser });
    vi.mocked(db.transaction).mockImplementation((cb) => cb(tx as never));

    const result = await upsertTelegramUser(basePayload);

    expect(result).toEqual(existingUser);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledWith(users);
    expect(tx.insert).not.toHaveBeenCalledWith(organizations);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("throws when the upsert returns no row", async () => {
    const tx = makeTx({ upsertedUser: undefined });
    vi.mocked(db.transaction).mockImplementation((cb) => cb(tx as never));

    await expect(upsertTelegramUser(basePayload)).rejects.toThrow(
      "upsertTelegramUser: upsert returned no row",
    );
  });
});
