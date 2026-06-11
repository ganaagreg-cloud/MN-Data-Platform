/**
 * MNT money helpers.
 *
 * parseMnt()  →  numeric string safe for numeric(18,2) columns.
 * formatMnt() →  "1,250,000₮" for display.
 *
 * Understands:
 *   "1,250,000₮"   plain with separators
 *   "1250000"       plain
 *   "1.25 сая"      сая = million
 *   "2 тэрбум"      тэрбум = billion
 */
export function parseMnt(input: string): string | null {
  const s = input.trim();

  const sayaMatch = s.match(/^([\d,]+(?:\.\d+)?)\s*сая/);
  if (sayaMatch?.[1]) {
    const n = parseFloat(sayaMatch[1].replace(/,/g, "")) * 1_000_000;
    return n.toFixed(2);
  }

  const terbumMatch = s.match(/^([\d,]+(?:\.\d+)?)\s*тэрбум/);
  if (terbumMatch?.[1]) {
    const n = parseFloat(terbumMatch[1].replace(/,/g, "")) * 1_000_000_000;
    return n.toFixed(2);
  }

  // Strip ₮, spaces, thousands separators, then accept plain decimal
  const plain = s.replace(/[₮\s,]/g, "");
  if (/^\d+(\.\d+)?$/.test(plain)) {
    return parseFloat(plain).toFixed(2);
  }

  return null;
}

export function formatMnt(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n.toLocaleString("en-US").split(".")[0] + "₮";
}
