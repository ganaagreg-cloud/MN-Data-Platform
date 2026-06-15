import { describe, it, expect } from "vitest";
import { parseChatId } from "./parse-chat-id";

describe("parseChatId", () => {
  it("accepts a positive user chat ID", () => {
    expect(parseChatId("123456789")).toEqual({ ok: true, value: "123456789" });
  });

  it("accepts a negative group chat ID", () => {
    expect(parseChatId("-1001234567890")).toEqual({ ok: true, value: "-1001234567890" });
  });

  it("trims whitespace", () => {
    expect(parseChatId("  99  ")).toEqual({ ok: true, value: "99" });
  });

  it("rejects empty string", () => {
    const r = parseChatId("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });

  it("rejects floats", () => {
    const r = parseChatId("123.4");
    expect(r.ok).toBe(false);
  });

  it("rejects non-numeric input", () => {
    const r = parseChatId("abc");
    expect(r.ok).toBe(false);
  });
});
