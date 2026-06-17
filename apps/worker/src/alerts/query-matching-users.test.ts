import { describe, it, expect, vi, beforeEach } from "vitest";

process.env["DATABASE_URL"] ??= "postgres://test:test@localhost:5432/test";
process.env["DATABASE_URL_DIRECT"] ??= "postgres://test:test@localhost:5432/test";

vi.mock("@mn-platform/db", async () => {
  const actual = await vi.importActual<typeof import("@mn-platform/db")>("@mn-platform/db");
  return {
    ...actual,
    db: { select: vi.fn() },
  };
});

const { db } = await import("@mn-platform/db");
const { queryMatchingUsers } = await import("./query-matching-users.js");

describe("queryMatchingUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] immediately when category is null (no DB call)", async () => {
    const result = await queryMatchingUsers(null);
    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns [] immediately when category is empty string (no DB call)", async () => {
    const result = await queryMatchingUsers("");
    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("queries DB and returns matched user IDs", async () => {
    const mockWhere = vi.fn().mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    const result = await queryMatchingUsers("IT");

    expect(db.select).toHaveBeenCalledOnce();
    expect(mockFrom).toHaveBeenCalledOnce();
    expect(mockInnerJoin).toHaveBeenCalledOnce();
    expect(mockWhere).toHaveBeenCalledOnce();
    expect(result).toEqual([{ userId: "user-1" }, { userId: "user-2" }]);
  });

  it("returns [] when no users match", async () => {
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
    const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as never);

    const result = await queryMatchingUsers("NonExistentCategory");

    expect(result).toEqual([]);
  });
});
