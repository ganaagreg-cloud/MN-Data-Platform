// apps/platform/src/app/api/telegram/webhook/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env["DATABASE_URL"] ??= "postgres://test:test@localhost:5432/test";
process.env["DATABASE_URL_DIRECT"] ??= "postgres://test:test@localhost:5432/test";
process.env["TELEGRAM_BOT_TOKEN"] ??= "test-bot-token";
process.env["BOT_USERNAME"] ??= "TestBot";
process.env["SESSION_SECRET"] ??= "a".repeat(32);

const findFirstAuthTokens = vi.fn();
const findFirstUsers = vi.fn();
const updateSet = vi.fn();
const updateWhere = vi.fn();
const insertValues = vi.fn();

vi.mock("@mn-platform/db", async () => {
  const actual = await vi.importActual<typeof import("@mn-platform/db")>("@mn-platform/db");
  return {
    ...actual,
    db: {
      query: {
        authTokens: { findFirst: findFirstAuthTokens },
        users: { findFirst: findFirstUsers },
      },
      update: vi.fn(() => ({ set: updateSet })),
      insert: vi.fn(() => ({ values: insertValues })),
    },
  };
});

const sendTelegramMessageTo = vi.fn().mockResolvedValue(undefined);
vi.mock("@mn-platform/core", () => ({ sendTelegramMessageTo }));

const { POST } = await import("./route");

function makeRequest(body: unknown): Request {
  return new Request("https://example.com/api/telegram/webhook", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const VALID_TOKEN = "a".repeat(32);

describe("POST /api/telegram/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSet.mockReturnValue({ where: updateWhere });
    updateWhere.mockResolvedValue(undefined);
    insertValues.mockResolvedValue(undefined);
  });

  it("upserts a new user and marks the token consumed for a valid /start auth_<token>", async () => {
    findFirstAuthTokens.mockResolvedValue({
      token: VALID_TOKEN,
      telegramId: null,
      consumed: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    findFirstUsers.mockResolvedValue(undefined);

    const res = await POST(makeRequest({
      message: {
        text: `/start auth_${VALID_TOKEN}`,
        chat: { id: 555 },
        from: { id: 999, username: "ganaa", first_name: "Ганаа" },
      },
    }));

    expect(res.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith({
      telegramId: 999,
      telegramUsername: "ganaa",
      firstName: "Ганаа",
      lastLoginAt: expect.any(Date),
    });
    expect(updateSet).toHaveBeenCalledWith({ telegramId: 999, consumed: true });
    expect(sendTelegramMessageTo).toHaveBeenCalledWith(555, expect.stringContaining("Амжилттай"));
  });

  it("updates the existing user when telegram_id already exists", async () => {
    findFirstAuthTokens.mockResolvedValue({
      token: VALID_TOKEN,
      telegramId: null,
      consumed: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    findFirstUsers.mockResolvedValue({ id: "user-1", telegramId: 999 });

    await POST(makeRequest({
      message: {
        text: `/start auth_${VALID_TOKEN}`,
        chat: { id: 555 },
        from: { id: 999, username: "ganaa", first_name: "Ганаа" },
      },
    }));

    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ lastLoginAt: expect.any(Date) }));
  });

  it("replies with an expired message and does not touch the DB for a consumed token", async () => {
    findFirstAuthTokens.mockResolvedValue({
      token: VALID_TOKEN,
      telegramId: 111,
      consumed: true,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await POST(makeRequest({
      message: {
        text: `/start auth_${VALID_TOKEN}`,
        chat: { id: 555 },
        from: { id: 999, username: "ganaa", first_name: "Ганаа" },
      },
    }));

    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(sendTelegramMessageTo).toHaveBeenCalledWith(555, expect.stringContaining("дууссан"));
  });

  it("replies with an expired message for an unknown token", async () => {
    findFirstAuthTokens.mockResolvedValue(undefined);

    await POST(makeRequest({
      message: {
        text: `/start auth_${VALID_TOKEN}`,
        chat: { id: 555 },
        from: { id: 999 },
      },
    }));

    expect(sendTelegramMessageTo).toHaveBeenCalledWith(555, expect.stringContaining("дууссан"));
  });

  it("sends a generic reply for /start without a token", async () => {
    await POST(makeRequest({
      message: {
        text: "/start",
        chat: { id: 555 },
        from: { id: 999 },
      },
    }));

    expect(findFirstAuthTokens).not.toHaveBeenCalled();
    expect(sendTelegramMessageTo).toHaveBeenCalledOnce();
  });

  it("returns 200 without dispatching for a body with no message", async () => {
    const res = await POST(makeRequest({ not: "a telegram update" }));

    expect(res.status).toBe(200);
    expect(sendTelegramMessageTo).not.toHaveBeenCalled();
  });

  it("returns 200 even when the request body is not valid JSON", async () => {
    const req = new Request("https://example.com/api/telegram/webhook", {
      method: "POST",
      body: "not json",
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
  });
});
