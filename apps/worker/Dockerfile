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

EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9090/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "apps/worker/dist/index.js"]
