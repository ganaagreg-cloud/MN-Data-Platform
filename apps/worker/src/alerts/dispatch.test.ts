// apps/worker/src/alerts/dispatch.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChannelProvider, Notification, Recipient, AlertJobPayload } from "./types.js";

// Mock the DB module — tests don't need a real connection
vi.mock("@mn-platform/db", () => {
  const mockUser = {
    id: "user-1",
    orgId: "org-1",
    email: "test@example.com",
    telegramChatId: null,
    phone: null,
  };
  const mockSubscription = {
    id: "sub-1",
    orgId: "org-1",
    status: "active",
    alertChannels: ["email"],
    modules: ["tender"],
  };
  const mockTender = {
    id: "tender-1",
    tenderNo: "ТД-001",
    procuringEntity: "Test Org",
    category: "IT",
    estBudgetMnt: "1000000.00",
    submissionDeadline: new Date("2026-07-01T00:00:00Z"),
    aimag: "УБ",
  };

  return {
    db: {
      query: {
        users: {
          findFirst: vi.fn().mockResolvedValue(mockUser),
        },
        subscriptions: {
          findFirst: vi.fn().mockResolvedValue(mockSubscription),
        },
        tenders: {
          findFirst: vi.fn().mockResolvedValue(mockTender),
        },
      },
    },
    users: { id: "users.id" },
    subscriptions: { orgId: "subscriptions.orgId", status: "subscriptions.status" },
    tenders: { id: "tenders.id" },
    notificationsSent: {},
  };
});

// Mock idempotency — always returns true (new notification)
vi.mock("./idempotency.js", () => ({
  insertNotificationSent: vi.fn().mockResolvedValue(true),
}));

// Re-import after mocks are set up
const { dispatchAlert } = await import("./dispatch.js");
const { insertNotificationSent } = await import("./idempotency.js");

function makeProvider(channel: "email" | "telegram" | "sms"): ChannelProvider & { send: ReturnType<typeof vi.fn> } {
  return { channel, send: vi.fn().mockResolvedValue(undefined) };
}

const payload: AlertJobPayload = {
  recordId: "tender-1",
  contentHash: "hash-abc",
  userId: "user-1",
};

describe("dispatchAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls send on the email provider", async () => {
    const emailProvider = makeProvider("email");
    await dispatchAlert(payload, [emailProvider]);
    expect(emailProvider.send).toHaveBeenCalledOnce();
  });

  it("calls insertNotificationSent after successful send", async () => {
    const emailProvider = makeProvider("email");
    await dispatchAlert(payload, [emailProvider]);
    expect(insertNotificationSent).toHaveBeenCalledWith({
      recordId: "tender-1",
      contentHash: "hash-abc",
      userId: "user-1",
      channel: "email",
    });
  });

  it("does not abort other channels when one fails", async () => {
    const { db } = await import("@mn-platform/db");
    (db.query.subscriptions.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "sub-1", orgId: "org-1", status: "active",
      alertChannels: ["email", "sms"], modules: ["tender"],
    });

    const emailProvider = makeProvider("email");
    const smsProvider = makeProvider("sms");
    smsProvider.send.mockRejectedValueOnce(new Error("SMS failed"));

    // Should throw because one channel failed, but email was still called
    await expect(dispatchAlert(payload, [emailProvider, smsProvider])).rejects.toThrow("SMS failed");
    expect(emailProvider.send).toHaveBeenCalledOnce();
  });

  it("returns without dispatching when subscription is inactive", async () => {
    const { db } = await import("@mn-platform/db");
    (db.query.subscriptions.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "sub-1", orgId: "org-1", status: "expired",
      alertChannels: ["email"], modules: ["tender"],
    });
    const emailProvider = makeProvider("email");
    await dispatchAlert(payload, [emailProvider]);
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it("skips dispatch entirely when the user has no org", async () => {
    const { db } = await import("@mn-platform/db");
    (db.query.users.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "user-1", orgId: null, email: "test@example.com", telegramChatId: null, phone: null,
    });

    const emailProvider = makeProvider("email");
    await dispatchAlert(payload, [emailProvider]);

    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(insertNotificationSent).not.toHaveBeenCalled();
  });

  it("skips the email channel when user.email is null, but still dispatches other channels", async () => {
    const { db } = await import("@mn-platform/db");
    (db.query.users.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "user-1", orgId: "org-1", email: null, telegramChatId: "chat-1", phone: null,
    });
    (db.query.subscriptions.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "sub-1", orgId: "org-1", status: "active",
      alertChannels: ["email", "telegram"], modules: ["tender"],
    });

    const emailProvider = makeProvider("email");
    const telegramProvider = makeProvider("telegram");
    await dispatchAlert(payload, [emailProvider, telegramProvider]);

    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(telegramProvider.send).toHaveBeenCalledOnce();
  });
});
