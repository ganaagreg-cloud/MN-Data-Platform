/** NFC-normalize, trim, collapse internal whitespace. Required before hashing/dedup. */
export function normalizeText(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}
