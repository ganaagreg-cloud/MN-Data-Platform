import { formatMnt } from "@mn-platform/mn";
import type { Notification } from "./types.js";

interface TenderSummary {
  id: string;
  tenderNo: string | null;
  procuringEntity: string | null;
  category: string | null;
  estBudgetMnt: string | null;
  submissionDeadline: Date | null;
  aimag: string | null;
}

function formatDeadline(d: Date | null): string {
  if (!d) return "тодорхойгүй";
  return d.toLocaleDateString("mn-MN", { timeZone: "Asia/Ulaanbaatar" });
}

export function formatTenderNotification(
  tender: TenderSummary,
  contentHash: string,
): Notification {
  const name = tender.tenderNo ?? tender.procuringEntity ?? tender.id;
  const deadline = formatDeadline(tender.submissionDeadline);
  const platformUrl = process.env["PLATFORM_URL"] ?? "https://tenderalert.mn";

  const body = [
    `Байгууллага: ${tender.procuringEntity ?? "—"}`,
    `Ангилал: ${tender.category ?? "—"}`,
    `Төсвийн дүн: ${tender.estBudgetMnt ? formatMnt(tender.estBudgetMnt) : "—"}`,
    `Дедлайн: ${deadline}`,
    `Аймаг/дүүрэг: ${tender.aimag ?? "—"}`,
    "",
    `Дэлгэрэнгүй: ${platformUrl}/tender/${tender.id}`,
    "",
    "TODO: digest hook — when user has digest enabled, accumulate",
    "Notification objects and flush in a scheduled batch job instead",
    "of calling provider.send() immediately. Key on (userId, digestDate).",
  ].join("\n");

  return {
    recordId: tender.id,
    contentHash,
    subject: `Шинэ тендер: ${name} — дедлайн ${deadline}`,
    body,
  };
}
