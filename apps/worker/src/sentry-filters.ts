// apps/worker/src/sentry-filters.ts
import type { ErrorEvent } from "@sentry/node";

// Playwright navigation failures (timeouts, detached frames) are routine
// scraper noise, not actionable bugs — drop them before they reach Sentry.
export function dropNavigationErrors(event: ErrorEvent): ErrorEvent | null {
  const isNavigationError = event.exception?.values?.some(
    (exception) => exception.type === "NavigationError",
  );
  return isNavigationError ? null : event;
}
