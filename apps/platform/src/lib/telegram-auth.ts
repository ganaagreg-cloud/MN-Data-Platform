import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

const MAX_AGE_SECONDS = 86400;

export const TELEGRAM_FIELDS = new Set([
  "auth_date",
  "first_name",
  "id",
  "last_name",
  "photo_url",
  "username",
]);

export function verifyTelegramPayload(payload: unknown, botToken: string): TelegramUser {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload");
  }

  const data = payload as Record<string, unknown>;

  const hash = data["hash"];
  if (typeof hash !== "string" || hash === "") {
    throw new Error("Missing hash");
  }

  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error("Hash mismatch");
  }

  // Only include Telegram's known signed fields — guards against Auth.js injecting
  // extra credential fields (e.g. csrfToken, redirect) into the check string.
  const checkParts = Object.entries(data)
    .filter(
      ([k, v]) =>
        k !== "hash" &&
        TELEGRAM_FIELDS.has(k) &&
        v !== undefined &&
        v !== null &&
        v !== "",
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`);

  const dataCheckString = checkParts.join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const sig = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (
    sig.length !== hash.length ||
    !timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(hash, "hex"))
  ) {
    throw new Error("Hash mismatch");
  }

  const authDate = Number(data["auth_date"]);
  if (!Number.isFinite(authDate)) throw new Error("Invalid auth_date");

  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds < 0 || ageSeconds > MAX_AGE_SECONDS) throw new Error("Auth data expired");

  const id = Number(data["id"]);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid id");

  const firstName = data["first_name"];
  if (typeof firstName !== "string" || firstName === "") {
    throw new Error("Missing first_name");
  }

  const result: TelegramUser = {
    id,
    first_name: firstName,
    auth_date: authDate,
    hash,
  };

  if (typeof data["last_name"] === "string" && data["last_name"] !== "") {
    result.last_name = data["last_name"];
  }

  if (typeof data["username"] === "string" && data["username"] !== "") {
    result.username = data["username"];
  }

  if (typeof data["photo_url"] === "string" && data["photo_url"] !== "") {
    result.photo_url = data["photo_url"];
  }

  return result;
}
