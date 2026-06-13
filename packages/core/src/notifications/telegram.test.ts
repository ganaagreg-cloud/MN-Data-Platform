// packages/core/src/notifications/telegram.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendTelegramMessage,
  sendTelegramMessageTo,
  formatListingAlert,
  formatTenderAlert,
} from "./telegram.js";
import type { ListingAlertInput, TenderAlertInput } from "./telegram.js";

const listing: ListingAlertInput = {
  listingType: "sale",
  district: "БГД",
  khoroo: "3р хороо",
  building: "Блок А",
  areaM2: 65,
  floor: 4,
  priceMnt: 185_000_000,
  url: "https://www.unegui.mn/adv/12345",
};

const tender: TenderAlertInput = {
  procuringEntity: "Боловсролын яам",
  title: "Сургуулийн тоног төхөөрөмж",
  submissionDeadline: new Date("2026-07-01T00:00:00Z"),
  estBudgetMnt: "500000000.00",
  url: "https://user.tender.gov.mn/mn/invitation/123",
};

describe("formatListingAlert", () => {
  it("formats a new listing", () => {
    const text = formatListingAlert(listing, "new");

    expect(text).toContain("<b>\u{1F3E0} GazarPrice — new listing</b>");
    expect(text).toContain("БГД, 3р хороо, Блок А");
    expect(text).toContain("Sale · 65 m² · Floor 4");
    expect(text).toContain("185,000,000₮");
    expect(text).toContain('<a href="https://www.unegui.mn/adv/12345">View listing</a>');
  });

  it("formats a changed listing with a price increase and percentage", () => {
    const text = formatListingAlert(
      { ...listing, previousPriceMnt: 150_000_000 },
      "changed",
    );

    expect(text).toContain("<b>\u{1F3E0} GazarPrice — updated listing</b>");
    expect(text).toContain("150,000,000₮ → 185,000,000₮ (+23.3%)");
  });

  it("formats a changed listing with a price decrease and negative percentage", () => {
    const text = formatListingAlert(
      { ...listing, priceMnt: 100_000_000, previousPriceMnt: 150_000_000 },
      "changed",
    );

    expect(text).toContain("150,000,000₮ → 100,000,000₮ (-33.3%)");
  });

  it("falls back to a plain price when previousPriceMnt is missing", () => {
    const text = formatListingAlert(listing, "changed");

    expect(text).toContain("\u{1F4B0} 185,000,000₮");
    expect(text).not.toContain("→");
  });

  it("falls back to a plain price when the price did not change", () => {
    const text = formatListingAlert(
      { ...listing, previousPriceMnt: 185_000_000 },
      "changed",
    );

    expect(text).toContain("\u{1F4B0} 185,000,000₮");
    expect(text).not.toContain("→");
  });

  it("avoids dividing by zero when previousPriceMnt is 0", () => {
    const text = formatListingAlert(
      { ...listing, previousPriceMnt: 0 },
      "changed",
    );

    expect(text).toContain("0₮ → 185,000,000₮");
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("%");
  });

  it("shows 'Unknown location' and placeholder area/floor when fields are null", () => {
    const text = formatListingAlert(
      {
        ...listing,
        district: null,
        khoroo: null,
        building: null,
        areaM2: null,
        floor: null,
        priceMnt: null,
      },
      "new",
    );

    expect(text).toContain("\u{1F4CD} Unknown location");
    expect(text).toContain("Sale · ? m² · Floor ?");
    expect(text).toContain("\u{1F4B0} —");
  });

  it("HTML-escapes user-supplied text fields", () => {
    const text = formatListingAlert(
      { ...listing, building: "<script>" },
      "new",
    );

    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<script>");
  });
});

describe("formatTenderAlert", () => {
  it("formats a tender with all fields present", () => {
    const text = formatTenderAlert(tender);

    expect(text).toContain("<b>\u{1F4CB} TenderAlert — new tender</b>");
    expect(text).toContain("\u{1F3E2} Боловсролын яам");
    expect(text).toContain("\u{1F4C4} Сургуулийн тоног төхөөрөмж");
    expect(text).toContain("⏰ Deadline: 2026-07-01");
    expect(text).toContain("\u{1F4B0} 500,000,000₮");
    expect(text).toContain('<a href="https://user.tender.gov.mn/mn/invitation/123">View tender</a>');
  });

  it("falls back to placeholders when fields are null", () => {
    const text = formatTenderAlert({
      procuringEntity: null,
      title: null,
      submissionDeadline: null,
      estBudgetMnt: null,
      url: "https://user.tender.gov.mn/mn/invitation/123",
    });

    expect(text).toContain("\u{1F3E2} —");
    expect(text).toContain("\u{1F4C4} —");
    expect(text).toContain("⏰ Deadline: —");
    expect(text).toContain("\u{1F4B0} —");
  });
});

describe("sendTelegramMessage", () => {
  const originalToken = process.env["TELEGRAM_BOT_TOKEN"];
  const originalChatId = process.env["TELEGRAM_CHAT_ID"];

  beforeEach(() => {
    process.env["TELEGRAM_BOT_TOKEN"] = "test-token";
    process.env["TELEGRAM_CHAT_ID"] = "test-chat-id";
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env["TELEGRAM_BOT_TOKEN"];
    else process.env["TELEGRAM_BOT_TOKEN"] = originalToken;
    if (originalChatId === undefined) delete process.env["TELEGRAM_CHAT_ID"];
    else process.env["TELEGRAM_CHAT_ID"] = originalChatId;
    vi.unstubAllGlobals();
  });

  it("POSTs to the Telegram Bot API with the expected shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramMessage("hello");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      chat_id: "test-chat-id",
      text: "hello",
      parse_mode: "HTML",
    });
  });

  it("throws when TELEGRAM_BOT_TOKEN is missing", async () => {
    delete process.env["TELEGRAM_BOT_TOKEN"];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessage("hello")).rejects.toThrow(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the Telegram API responds with a non-2xx status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request: chat not found",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessage("hello")).rejects.toThrow(
      "Telegram sendMessage failed: 400 Bad Request: chat not found",
    );
  });
});

describe("sendTelegramMessageTo", () => {
  const originalToken = process.env["TELEGRAM_BOT_TOKEN"];

  beforeEach(() => {
    process.env["TELEGRAM_BOT_TOKEN"] = "test-token";
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env["TELEGRAM_BOT_TOKEN"];
    else process.env["TELEGRAM_BOT_TOKEN"] = originalToken;
    vi.unstubAllGlobals();
  });

  it("POSTs to the given chatId using TELEGRAM_BOT_TOKEN", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramMessageTo(987654321, "hi there");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      chat_id: 987654321,
      text: "hi there",
      parse_mode: "HTML",
    });
  });

  it("throws when TELEGRAM_BOT_TOKEN is missing", async () => {
    delete process.env["TELEGRAM_BOT_TOKEN"];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessageTo(123, "hi")).rejects.toThrow("TELEGRAM_BOT_TOKEN must be set");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the Telegram API responds with a non-2xx status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "Forbidden" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessageTo(123, "hi")).rejects.toThrow("Telegram sendMessage failed: 403 Forbidden");
  });
});
