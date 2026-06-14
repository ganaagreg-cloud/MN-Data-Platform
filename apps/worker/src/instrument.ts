// apps/worker/src/instrument.ts
//
// Must be the very first import in index.ts — before logger, pg-boss,
// anything — so Sentry is initialized before any other module can throw.
import * as Sentry from "@sentry/node";
import { env } from "./env.js";
import { dropNavigationErrors } from "./sentry-filters.js";

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  release: env.GIT_SHA,
  tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
  beforeSend: dropNavigationErrors,
});
