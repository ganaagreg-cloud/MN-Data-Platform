// apps/platform/src/app/(dashboard)/dashboard/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, tenders, subscriptions, eq, and, asc, sql } from "@mn-platform/db";
import { formatMnt } from "@mn-platform/mn";
import { CategoryPicker } from "./category-picker";

const AIMAGS = [
  "Улаанбаатар",
  "Архангай", "Баян-Өлгий", "Баянхонгор", "Булган", "Говь-Алтай",
  "Говьсүмбэр", "Дархан-Уул", "Дорноговь", "Дорнод", "Дундговь",
  "Завхан", "Орхон", "Өвөрхангай", "Өмнөговь", "Сүхбаатар",
  "Сэлэнгэ", "Төв", "Увс", "Хентий", "Ховд", "Хөвсгөл",
] as const;

interface Cursor {
  deadline: string | null;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(s: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString()) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      typeof (parsed as Record<string, unknown>).id === "string" &&
      "deadline" in parsed &&
      (typeof (parsed as Record<string, unknown>).deadline === "string" ||
        (parsed as Record<string, unknown>).deadline === null)
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

const STATUS_LABELS: Record<string, string> = {
  announced: "Зарлагдсан",
  open:      "Нээлттэй",
  closed:    "Хаагдсан",
  awarded:   "Шийдвэрлэсэн",
  cancelled: "Цуцлагдсан",
};

const STATUS_COLORS: Record<string, string> = {
  announced: "bg-blue-100 text-blue-800",
  open:      "bg-green-100 text-green-800",
  closed:    "bg-gray-100 text-gray-700",
  awarded:   "bg-teal-100 text-teal-800",
  cancelled: "bg-red-100 text-red-700",
};

const PAGE_SIZE = 20;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; aimag?: string; cursor?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const params = await searchParams;
  const statusParam = params.status === "open" || params.status === "closed" ? params.status : undefined;
  const aimagParam  = typeof params.aimag === "string" && params.aimag ? params.aimag : undefined;
  const cursor      = params.cursor ? decodeCursor(params.cursor) : null;

  // Use relational query builder (db was initialised with { schema })
  const [subscription] = await db
    .select({ categories: subscriptions.categories })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, session.user.orgId))
    .limit(1);

  const userCategories: string[] = subscription?.categories ?? [];

  if (userCategories.length === 0) {
    return (
      <main className="min-h-screen">
        <CategoryPicker />
      </main>
    );
  }

  // Keyset cursor filter — order is (submissionDeadline ASC NULLS LAST, id ASC)
  const cursorFilter = cursor
    ? cursor.deadline === null
      ? sql`(${tenders.submissionDeadline} IS NULL AND ${tenders.id} > ${cursor.id}::uuid)`
      : sql`(
          ${tenders.submissionDeadline} > ${cursor.deadline}::timestamptz
          OR (
            ${tenders.submissionDeadline} = ${cursor.deadline}::timestamptz
            AND ${tenders.id} > ${cursor.id}::uuid
          )
          OR ${tenders.submissionDeadline} IS NULL
        )`
    : undefined;

  // category is nullable (text | null) on the column, so use sql ANY() to avoid
  // Drizzle's inArray type restriction on nullable columns.
  // Passing a JS string[] inside the sql tag makes drizzle bind it as a Postgres
  // array parameter: WHERE category = ANY($1::text[])
  const categoryFilter = sql<boolean>`${tenders.category} = ANY(${userCategories})`;

  const rows = await db
    .select({
      id:                 tenders.id,
      tenderNo:           tenders.tenderNo,
      procuringEntity:    tenders.procuringEntity,
      estBudgetMnt:       tenders.estBudgetMnt,
      submissionDeadline: tenders.submissionDeadline,
      status:             tenders.status,
      aimag:              tenders.aimag,
    })
    .from(tenders)
    .where(
      and(
        categoryFilter,
        statusParam ? eq(tenders.status, statusParam) : undefined,
        aimagParam  ? eq(tenders.aimag, aimagParam)   : undefined,
        cursorFilter,
      ),
    )
    .orderBy(sql`${tenders.submissionDeadline} ASC NULLS LAST`, asc(tenders.id))
    .limit(PAGE_SIZE + 1);

  const hasNextPage  = rows.length > PAGE_SIZE;
  const displayRows  = hasNextPage ? rows.slice(0, PAGE_SIZE) : rows;
  const lastRow      = displayRows[displayRows.length - 1];
  const nextCursor   = hasNextPage && lastRow
    ? encodeCursor({
        deadline: lastRow.submissionDeadline?.toISOString() ?? null,
        id:       lastRow.id,
      })
    : null;

  function nextPageUrl(): string {
    const p = new URLSearchParams();
    if (statusParam) p.set("status", statusParam);
    if (aimagParam)  p.set("aimag", aimagParam);
    if (nextCursor)  p.set("cursor", nextCursor);
    const qs = p.toString();
    return `/dashboard${qs ? `?${qs}` : ""}`;
  }

  function filterUrl(overrides: Record<string, string | undefined>): string {
    const p = new URLSearchParams();
    const merged = { status: statusParam, aimag: aimagParam, ...overrides };
    if (merged.status) p.set("status", merged.status);
    if (merged.aimag)  p.set("aimag", merged.aimag);
    const qs = p.toString();
    return `/dashboard${qs ? `?${qs}` : ""}`;
  }

  return (
    <main className="min-h-screen px-4 py-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Тендер</h1>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4 text-sm">
        <a
          href={filterUrl({ status: undefined })}
          className={`px-3 py-1 rounded-full border ${!statusParam ? "bg-gray-900 text-white border-gray-900" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
        >
          Бүгд
        </a>
        <a
          href={filterUrl({ status: "open" })}
          className={`px-3 py-1 rounded-full border ${statusParam === "open" ? "bg-green-600 text-white border-green-600" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
        >
          Нээлттэй
        </a>
        <a
          href={filterUrl({ status: "closed" })}
          className={`px-3 py-1 rounded-full border ${statusParam === "closed" ? "bg-gray-600 text-white border-gray-600" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
        >
          Хаагдсан
        </a>

        <form method="GET" action="/dashboard" className="flex items-center gap-2 ml-auto">
          {statusParam && <input type="hidden" name="status" value={statusParam} />}
          <select
            name="aimag"
            defaultValue={aimagParam ?? ""}
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
            aria-label="Аймаг/нийслэл шүүх"
          >
            <option value="">Бүх аймаг</option>
            {AIMAGS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button type="submit" className="px-3 py-1 bg-gray-900 text-white rounded text-sm">
            Шүүх
          </button>
          {aimagParam && (
            <a href={filterUrl({ aimag: undefined })} className="text-gray-500 hover:text-gray-800">
              &#x2715;
            </a>
          )}
        </form>
      </div>

      {/* Empty state */}
      {displayRows.length === 0 ? (
        <div className="py-16 text-center text-gray-500">
          <p className="text-lg mb-2">Тохирох тендер олдсонгүй</p>
          <p className="text-sm">Шүүлтүүрийг өөрчилж үзнэ үү.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Дугаар</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Байгууллага</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Төсөв</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Дедлайн</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Төлөв</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">
                    {row.tenderNo ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-900 max-w-xs truncate">
                    {row.procuringEntity ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900 whitespace-nowrap">
                    {row.estBudgetMnt != null ? formatMnt(row.estBudgetMnt) : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {row.submissionDeadline
                      ? row.submissionDeadline.toLocaleDateString("mn-MN", {
                          timeZone: "Asia/Ulaanbaatar",
                        })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[row.status] ?? "bg-gray-100 text-gray-700"}`}
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Next page link */}
      {nextCursor && (
        <div className="mt-4 text-right">
          <a
            href={nextPageUrl()}
            className="inline-block px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
          >
            Дараах &#x2192;
          </a>
        </div>
      )}
    </main>
  );
}
