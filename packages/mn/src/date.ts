/**
 * Parse Mongolian date strings into UTC Dates.
 *
 * Supported formats (Ulaanbaatar = UTC+8, no DST):
 *   "2024.05.31"          YYYY.MM.DD
 *   "2024-05-31"          YYYY-MM-DD
 *   "2024.05.31 14:30"    YYYY.MM.DD HH:mm
 *   "2024-05-31 14:30"    YYYY-MM-DD HH:mm
 *
 * Deadlines are deadline-critical — always store UTC so the app can
 * compare against server time without TZ confusion.
 */

// Ulaanbaatar is UTC+8, fixed offset, no DST.
const UB_OFFSET_MS = 8 * 60 * 60 * 1000;

function ubToUtc(y: number, m: number, d: number, h = 0, min = 0): Date {
  // Date.UTC treats its args as UTC; subtracting the UB offset converts
  // UB local time → UTC.
  return new Date(Date.UTC(y, m - 1, d, h, min, 0) - UB_OFFSET_MS);
}

export function parseMnDate(input: string): Date | null {
  const s = input.trim();

  // YYYY.MM.DD HH:mm  or  YYYY-MM-DD HH:mm
  const withTime = s.match(
    /^(\d{4})[.-](\d{1,2})[.-](\d{1,2})\s+(\d{1,2}):(\d{2})/,
  );
  if (withTime) {
    const [, y, mo, d, h, mi] = withTime;
    if (y && mo && d && h && mi) {
      return ubToUtc(+y, +mo, +d, +h, +mi);
    }
  }

  // YYYY.MM.DD  or  YYYY-MM-DD
  const dateOnly = s.match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})/);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    if (y && mo && d) {
      return ubToUtc(+y, +mo, +d);
    }
  }

  return null;
}
