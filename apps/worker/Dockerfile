# apps/worker/Dockerfile

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder
RUN npm install -g pnpm@11.5.2
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

COPY --from=builder /app .

# Playwright + Chromium system deps must be in the runner image, not the builder,
# so the final layer contains all required shared libraries.
# Install system dependencies for Playwright + Chromium.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgconf-2-4 \
    libx11-xcb1 \
    libxkbcommon0 \
    libxss1 \
    libxtst6 \
    libnss3 \
    libatk-wrapper-java-jni \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9090/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "apps/worker/dist/index.js"]
