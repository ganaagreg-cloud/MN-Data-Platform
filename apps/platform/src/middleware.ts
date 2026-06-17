import { NextResponse, type NextFetchEvent, type NextMiddleware } from "next/server";
import { auth } from "@/auth";
import type { NextAuthRequest } from "next-auth";

const PUBLIC_PREFIXES = ["/login", "/onboarding", "/api/auth"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAdminId(telegramId: number): boolean {
  const ids = (process.env["ADMIN_TELEGRAM_IDS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(String(telegramId));
}

const middleware: NextMiddleware = auth(
  (req: NextAuthRequest, _event: NextFetchEvent) => {
    const { pathname } = req.nextUrl;
    const session = req.auth;

    // Redirect already-authenticated users away from /login
    if (pathname === "/login" && session) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    if (isPublic(pathname)) {
      return NextResponse.next();
    }

    // Session required for all non-public routes
    if (!session) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    // /admin is restricted — 403 (not a redirect, to avoid leaking route existence)
    if (pathname.startsWith("/admin") && !isAdminId(session.user.telegramId)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // TODO: replace this fragile proxy with a proper users.has_completed_onboarding
    // boolean once /settings exists — email-null will break as the gate once we
    // allow users who never set an email (e.g. Telegram-only accounts).
    if (!session.user.email) {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }

    return NextResponse.next();
  },
);

export default middleware;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
