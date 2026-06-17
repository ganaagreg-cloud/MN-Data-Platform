"use client";

import { useState, useActionState } from "react";
import { TENDER_CATEGORIES } from "@/lib/tender-categories";
import { saveDashboardCategories } from "./actions";

export function CategoryPicker() {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [state, action, isPending] = useActionState(saveDashboardCategories, null);

  const toggle = (cat: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  return (
    <div className="flex flex-col items-center gap-6 py-16 px-4 text-center">
      <h2 className="text-2xl font-semibold">Ангилал сонгоно уу</h2>
      <p className="text-gray-500 max-w-sm">
        Хянахыг хүссэн тендерийн ангиллуудаа сонгоно уу. Дараа нь тохирох тендерүүд энд харагдана.
      </p>
      <form action={action} className="flex flex-col gap-2 text-left w-full max-w-xs">
        {TENDER_CATEGORIES.map((cat) => (
          <label key={cat} className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              name="categories"
              value={cat}
              className="accent-blue-600"
              checked={checked.has(cat)}
              onChange={() => toggle(cat)}
              disabled={isPending}
            />
            {cat}
          </label>
        ))}
        {state?.error && (
          <p role="alert" className="text-red-600 text-sm mt-1">
            {state.error}
          </p>
        )}
        <button
          type="submit"
          disabled={isPending || checked.size === 0}
          className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Хадгалж байна…" : "Хадгалах"}
        </button>
      </form>
    </div>
  );
}
