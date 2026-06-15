// apps/platform/src/app/admin/layout.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user.isAdmin) redirect("/login");
  return <>{children}</>;
}
