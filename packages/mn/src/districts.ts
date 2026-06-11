export const DISTRICTS = [
  "Баянзүрх",
  "Сүхбаатар",
  "Чингэлтэй",
  "Хан-Уул",
  "Сонгинохайрхан",
  "Баянгол",
  "Налайх",
  "Багануур",
  "Багахангай",
] as const;

export type District = (typeof DISTRICTS)[number];

const DISTRICT_MAP: Record<string, District> = {
  баянзүрх: "Баянзүрх",
  бзд: "Баянзүрх",
  сүхбаатар: "Сүхбаатар",
  сбд: "Сүхбаатар",
  чингэлтэй: "Чингэлтэй",
  чд: "Чингэлтэй",
  "хан-уул": "Хан-Уул",
  "хан уул": "Хан-Уул",
  худ: "Хан-Уул",
  сонгинохайрхан: "Сонгинохайрхан",
  схд: "Сонгинохайрхан",
  баянгол: "Баянгол",
  бгд: "Баянгол",
  налайх: "Налайх",
  багануур: "Багануур",
  багахангай: "Багахангай",
};

/** Maps full names and abbreviations (БЗД, СБД …) to canonical District. */
export function normalizeDistrict(raw: string): District | null {
  const key = raw.normalize("NFC").toLowerCase().trim();
  return DISTRICT_MAP[key] ?? null;
}
