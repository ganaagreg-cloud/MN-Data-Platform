export function parseChatId(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Chat ID is required" };
  if (trimmed.includes(".")) return { ok: false, error: "Chat ID must be a whole number" };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || Number.isNaN(n)) {
    return { ok: false, error: "Chat ID must be a whole number" };
  }
  return { ok: true, value: trimmed };
}
