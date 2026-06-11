import { createHash } from "node:crypto";

/**
 * SHA-256 hash of an arbitrary string, hex-encoded.
 * Use for contentHash() — pass only canonical business fields.
 */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
