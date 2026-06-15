// apps/platform/src/lib/plans.ts
export const PLAN_VALUES = ["tender", "gazar", "both"] as const;
export type Plan = (typeof PLAN_VALUES)[number];

export function parsePlan(value: string | string[] | undefined): Plan | undefined {
  return typeof value === "string" && (PLAN_VALUES as readonly string[]).includes(value)
    ? (value as Plan)
    : undefined;
}
